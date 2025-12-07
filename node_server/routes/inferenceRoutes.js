import express from "express";
import multer from "multer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { runInference, getUserResults } from "../controllers/inferenceController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Multer setup for temporary file storage
const upload = multer({ dest: "uploads/" });

// Audio segmentation endpoint
router.post("/segment", authMiddleware, upload.single("file"), runInference);

// Fetch user’s saved outputs
router.get("/results", authMiddleware, getUserResults);

export default router;
