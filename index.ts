import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();

const uploadDir = path.resolve(process.cwd(), "upload");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}-${random}${ext}`);
  },
});

const upload = multer({ storage });
const indexHtmlPath = path.resolve(process.cwd(), "index.html");

app.get("/", (_req, res) => {
  res.sendFile(indexHtmlPath);
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  res.status(201).json({
    originalName: req.file.originalname,
    storedName: req.file.filename,
    size: req.file.size,
    path: req.file.path,
  });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Upload server listening on http://0.0.0.0:${port}`);
});
