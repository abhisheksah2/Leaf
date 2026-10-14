const sampleSelect = document.getElementById("sampleSelect");
const fileInput = document.getElementById("fileInput");
const imagePreview = document.getElementById("imagePreview");
const analyzeBtn = document.getElementById("analyzeBtn");
const resetBtn = document.getElementById("resetBtn");
const resultEl = document.getElementById("result");
const explanationEl = document.getElementById("explanation");
const confBar = document.getElementById("confBar");
const hiddenCanvas = document.getElementById("hiddenCanvas");
const meta = document.getElementById("meta");
const downloadReport = document.getElementById("downloadReport");

let currentImage = null;
let lastReport = null;

// Load sample by URL using fetch -> blob to avoid some CORS issues
sampleSelect.addEventListener("change", async () => {
  const url = sampleSelect.value;
  if (!url) return;
  try {
    // fetch as blob to avoid tainting if allowed by server CORS settings
    const resp = await fetch(url);
    const blob = await resp.blob();
    const objectURL = URL.createObjectURL(blob);
    loadImage(objectURL, "sample");
  } catch (err) {
    // fallback: set src directly (may fail when analyzing due to CORS)
    loadImage(url, "sample (direct)");
  }
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  loadImage(url, f.name || "uploaded file");
});

analyzeBtn.addEventListener("click", () => {
  if (!currentImage) {
    alert("Please select or upload an image first.");
    return;
  }
  analyzeCurrentImage();
});

resetBtn.addEventListener("click", () => {
  imagePreview.src = "";
  currentImage = null;
  resultEl.textContent = "No analysis yet";
  explanationEl.textContent = "";
  confBar.style.width = "0%";
  meta.textContent = "";
  lastReport = null;
});

downloadReport.addEventListener("click", () => {
  if (!lastReport) {
    alert("No report yet. Run analysis first.");
    return;
  }
  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(lastReport, null, 2));
  const a = document.createElement("a");
  a.href = dataStr;
  a.download = "leaf_report.json";
  a.click();
});

function loadImage(src, label) {
  const img = new Image();
  img.crossOrigin = "Anonymous"; // try to avoid tainting
  img.onload = () => {
    currentImage = img;
    imagePreview.src = src;
    meta.textContent = `Source: ${label} • ${img.width}×${img.height}px`;
    resultEl.textContent = "Ready to analyze";
    explanationEl.textContent = "";
    confBar.style.width = "0%";
  };
  img.onerror = (e) => {
    alert(
      "Could not load image (CORS or network). Try uploading a local file."
    );
  };
  img.src = src;
}

function analyzeCurrentImage() {
  const canvas = hiddenCanvas;
  const ctx = canvas.getContext("2d");

  // Resize to fixed size for analysis
  const size = 224;
  canvas.width = size;
  canvas.height = size;
  // Draw image centered and scaled to canvas
  const img = currentImage;
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const dx = (size - w) / 2;
  const dy = (size - h) / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, dx, dy, w, h);

  let data;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch (err) {
    alert(
      "Could not access image pixels (canvas tainted by CORS). Use a locally uploaded image or run a local server."
    );
    return;
  }

  const counts = { white: 0, yellow: 0, brown: 0, green: 0, dark: 0 };
  const totalPixels = size * size;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      a = data[i + 3];
    if (a < 10) {
      continue;
    } // transparent
    // luminance
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // White / powdery: very high RGB values
    if (r > 220 && g > 220 && b > 220) counts.white++;
    // Yellowish (chlorosis): high r & g, lower b
    else if (r > 160 && g > 140 && b < 140 && r - b > 30) counts.yellow++;
    // Brown spots: reddish-brown dark patches
    else if (r > 80 && g < 100 && b < 90 && lum < 120) counts.brown++;
    // Green: much more green than others
    else if (g > r + 25 && g > b + 25 && g > 80) counts.green++;
    if (lum < 60) counts.dark++;
  }

  const whitePct = counts.white / totalPixels;
  const yellowPct = counts.yellow / totalPixels;
  const brownPct = counts.brown / totalPixels;
  const greenPct = counts.green / totalPixels;
  const darkPct = counts.dark / totalPixels;

  // Heuristic decision tree (sample/demo)
  let label = "Unknown / needs review";
  let confidence = 0.35;
  let explanation = "";

  if (whitePct > 0.05) {
    label = "Powdery mildew (sample)";
    confidence = Math.min(0.95, 0.4 + whitePct * 6);
    explanation = `Detected whitish powder-like pixels (~${(
      whitePct * 100
    ).toFixed(1)}% of area).`;
  } else if (brownPct > 0.02) {
    label = "Leaf spot (fungal/bacterial) (sample)";
    confidence = Math.min(0.95, 0.4 + brownPct * 12);
    explanation = `Spotted brown/dark lesions detected (~${(
      brownPct * 100
    ).toFixed(1)}% of area).`;
  } else if (yellowPct > 0.03) {
    label = "Chlorosis / nutrient deficiency (sample)";
    confidence = Math.min(0.9, 0.35 + yellowPct * 8);
    explanation = `Yellowing detected (~${(yellowPct * 100).toFixed(
      1
    )}% of area).`;
  } else if (greenPct > 0.45 && darkPct < 0.12) {
    label = "Healthy (sample)";
    confidence = Math.min(0.95, 0.5 + greenPct * 0.8);
    explanation = `Dominant healthy green detected (~${(greenPct * 100).toFixed(
      1
    )}% of area).`;
  } else if (darkPct > 0.25) {
    label = "Severe damage / necrosis (sample)";
    confidence = Math.min(0.92, 0.4 + darkPct * 1.6);
    explanation = `Large dark areas detected (~${(darkPct * 100).toFixed(
      1
    )}% of area).`;
  } else {
    label = "Uncertain (sample)";
    confidence = 0.4;
    explanation = `No strong heuristic pattern found. Green: ${(
      greenPct * 100
    ).toFixed(1)}%, White: ${(whitePct * 100).toFixed(1)}%, Brown: ${(
      brownPct * 100
    ).toFixed(1)}%.`;
  }

  // Build report
  const report = {
    timestamp: new Date().toISOString(),
    label,
    confidence: Number(confidence.toFixed(2)),
    explanation,
    pixel_stats: {
      totalPixels,
      whitePct: Number(whitePct.toFixed(4)),
      yellowPct: Number(yellowPct.toFixed(4)),
      brownPct: Number(brownPct.toFixed(4)),
      greenPct: Number(greenPct.toFixed(4)),
      darkPct: Number(darkPct.toFixed(4)),
    },
  };

  lastReport = report;
  displayReport(report);
}

function displayReport(r) {
  resultEl.textContent = r.label;
  explanationEl.textContent = r.explanation;
  confBar.style.width = r.confidence * 100 + "%";
  confBar.style.background =
    r.confidence > 0.6 ? "#34d399" : r.confidence > 0.4 ? "#f59e0b" : "#ef4444";
}
