import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import crypto from "crypto";
import User from "../models/User.js";
import ProcessedStem from "../models/ProcessedStem.js";
import dotenv from "dotenv";
dotenv.config();

const computeFileHash = (filePath) => (
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  })
);

const persistUserOutput = async (userId, inputName, cacheId, stems) => {
  const user = await User.findById(userId);
  if (!user) {
    console.warn("User not found while saving outputs", userId);
    return;
  }

  const outputUrls = stems.map(stem => stem.url);
  user.savedOutputs.push({
    inputName,
    cacheId,
    outputUrls,
    stems,
  });
  await user.save();
};

const removeFileQuietly = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (cleanupErr) {
    console.warn("Failed to delete temporary file", cleanupErr.message);
  }
};

export const runInference = async (req, res) => {
  let tempFilePath;
  try {
    const audioFile = req.file;
    if (!audioFile) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    tempFilePath = audioFile.path;
    const cacheId = await computeFileHash(tempFilePath);

    const cachedStem = await ProcessedStem.findOne({ cacheId });
    if (cachedStem) {
      const cachedStems = (cachedStem.stems && cachedStem.stems.length)
        ? cachedStem.stems
        : cachedStem.outputUrls.map((url, idx) => ({ name: `Stem ${idx + 1}`, url }));

      await persistUserOutput(req.user.id, audioFile.originalname, cacheId, cachedStems);

      return res.json({
        status: "cached",
        cacheId,
        outputs: cachedStems.map(stem => stem.url),
        stems: cachedStems,
      });
    }

    // Create form-data to forward to FastAPI
    const formData = new FormData();
    formData.append("file", fs.createReadStream(tempFilePath), audioFile.originalname);
    formData.append("cache_id", cacheId);

    // Optional: log to debug
    console.log("Forwarding to FastAPI:", process.env.FASTAPI_URL);

    // Send audio to FastAPI
    const response = await axios.post(
      `${process.env.FASTAPI_URL}/infer`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const resolvedCacheId = response.data.cache_id || cacheId;
    const responseFiles = response.data.files || [];
    const normalizedStems = (response.data.stems && response.data.stems.length)
      ? response.data.stems
      : responseFiles.map((url, idx) => ({ name: `Stem ${idx + 1}`, url }));

    await ProcessedStem.findOneAndUpdate(
      { cacheId: resolvedCacheId },
      {
        cacheId: resolvedCacheId,
        inputName: audioFile.originalname,
        outputUrls: normalizedStems.map(stem => stem.url),
        stems: normalizedStems,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Save result for user
    await persistUserOutput(req.user.id, audioFile.originalname, resolvedCacheId, normalizedStems);

    res.json({
      status: response.data.status || "success",
      cacheId: resolvedCacheId,
      outputs: normalizedStems.map(stem => stem.url),
      stems: normalizedStems,
    });

  } catch (err) {
    console.error("Error during inference:", err.response?.data || err.message);
    res.status(500).json({
      status: "error",
      message: err.response?.data || err.message,
    });
  } finally {
    removeFileQuietly(tempFilePath);
  }
};

export const getUserResults = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const user = await User.findById(userId)
      .select("savedOutputs")
      .lean();

    if (!user) return res.status(404).json({ message: "User not found" });

    const sorted = [...user.savedOutputs].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    const paginated = sorted.slice(skip, skip + limit);

    res.json({
      total: user.savedOutputs.length,
      page,
      limit,
      results: paginated.map(o => ({
        inputName: o.inputName,
        cacheId: o.cacheId,
        createdAt: new Date(o.createdAt).toLocaleString(),
        outputUrls: o.outputUrls,
        stems: (o.stems && o.stems.length)
          ? o.stems
          : (o.outputUrls || []).map((url, idx) => ({ name: `Stem ${idx + 1}`, url })),
      }))
    });
  } catch (err) {
    console.error("Error fetching user results:", err);
    res.status(500).json({ message: err.message });
  }
};
