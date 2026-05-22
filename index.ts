import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();

const uploadDir = path.resolve(process.cwd(), "upload");
fs.mkdirSync(uploadDir, { recursive: true });

const shareDir = path.resolve(process.cwd(), "share");
fs.mkdirSync(shareDir, { recursive: true });
const shareRoot = fs.realpathSync(shareDir);

const resolveSharePath = (inputPath: unknown) => {
  const rawPath = Array.isArray(inputPath)
    ? typeof inputPath[0] === "string"
      ? inputPath[0]
      : ""
    : typeof inputPath === "string"
      ? inputPath
      : "";
  const cleaned = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolutePath = path.resolve(shareRoot, cleaned);
  const relativePath = path.relative(shareRoot, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  const normalized = relativePath ? relativePath.split(path.sep).join("/") : "";

  return {
    absolutePath,
    relativePath: normalized === "." ? "" : normalized,
  };
};

const toShareUrl = (relativePath: string) => {
  if (!relativePath) {
    return "/share/";
  }

  const encoded = relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/share/${encoded}`;
};

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

app.get("/share/list", async (req, res) => {
  const resolved = resolveSharePath(req.query.path);
  if (!resolved) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  try {
    const stats = await fs.promises.stat(resolved.absolutePath);
    if (!stats.isDirectory()) {
      res.status(400).json({ error: "Path is not a directory" });
      return;
    }

    const entries = await fs.promises.readdir(resolved.absolutePath, {
      withFileTypes: true,
    });

    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    const responseEntries = await Promise.all(
      sortedEntries.map(async (entry) => {
        const entryAbsolute = path.join(resolved.absolutePath, entry.name);
        const entryStats = await fs.promises.stat(entryAbsolute);
        const entryPath = [resolved.relativePath, entry.name]
          .filter(Boolean)
          .join("/");

        if (entry.isDirectory()) {
          return {
            name: entry.name,
            type: "directory" as const,
            path: entryPath,
            modifiedAt: entryStats.mtime.toISOString(),
            browseUrl: `/share/list?path=${encodeURIComponent(entryPath)}`,
          };
        }

        return {
          name: entry.name,
          type: "file" as const,
          path: entryPath,
          size: entryStats.size,
          modifiedAt: entryStats.mtime.toISOString(),
          downloadUrl: `/share/download?path=${encodeURIComponent(entryPath)}`,
          url: toShareUrl(entryPath),
        };
      }),
    );

    res
      .status(200)
      .json({ path: resolved.relativePath, entries: responseEntries });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "Path not found" });
      return;
    }
    if (err.code === "ENOTDIR") {
      res.status(400).json({ error: "Path is not a directory" });
      return;
    }
    res.status(500).json({ error: "Unable to list shared files" });
  }
});

app.get("/share/download", async (req, res) => {
  const resolved = resolveSharePath(req.query.path);
  if (!resolved) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  try {
    const stats = await fs.promises.stat(resolved.absolutePath);
    if (!stats.isFile()) {
      res.status(400).json({ error: "Path is not a file" });
      return;
    }

    res.download(resolved.absolutePath, path.basename(resolved.absolutePath));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.status(500).json({ error: "Unable to download file" });
  }
});

app.use("/share", express.static(shareRoot, { index: false }));

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
