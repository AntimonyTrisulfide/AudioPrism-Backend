import mongoose from "mongoose";

const stemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const processedStemSchema = new mongoose.Schema({
  cacheId: { type: String, required: true, unique: true },
  inputName: { type: String },
  stems: { type: [stemSchema], default: [] },
  outputUrls: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
});

const ProcessedStem = mongoose.model("ProcessedStem", processedStemSchema);
export default ProcessedStem;
