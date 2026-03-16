const Busboy = require("busboy");
const FormData = require("form-data");
const fetch = require("node-fetch");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const contentType =
      event.headers["content-type"] || event.headers["Content-Type"];

    if (!contentType || !contentType.includes("multipart/form-data")) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Expected multipart/form-data" }),
      };
    }

    const parsed = await parseMultipart(event, contentType);

    if (!parsed.fileBuffer || !parsed.fileName) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "No PDF file uploaded" }),
      };
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "drerhl1gv";
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || "Invoice";

    const form = new FormData();
    form.append("file", parsed.fileBuffer, {
      filename: parsed.fileName,
      contentType: "application/pdf",
    });
    form.append("upload_preset", uploadPreset);
    form.append("folder", "invoice-pdfs");
    form.append("public_id", sanitizeFileName(parsed.fileName.replace(/\.pdf$/i, "")));

    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`;

    const uploadRes = await fetch(cloudinaryUrl, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    const uploadData = await uploadRes.json();

    if (!uploadRes.ok) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: "Cloudinary upload failed",
          details: uploadData,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        url: uploadData.secure_url,
        fileName: parsed.fileName,
        docType: parsed.fields.docType || "",
        docNumber: parsed.fields.docNumber || "",
      }),
    };
  } catch (error) {
    console.error("Upload error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: "Upload failed",
        message: error.message,
      }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function sanitizeFileName(name) {
  return name
    .trim()
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseMultipart(event, contentType) {
  return new Promise((resolve, reject) => {
    const result = {
      fields: {},
      fileBuffer: null,
      fileName: null,
    };

    const bb = Busboy({ headers: { "content-type": contentType } });

    bb.on("file", (fieldname, file, info) => {
      const { filename } = info;
      const chunks = [];

      file.on("data", (data) => chunks.push(data));

      file.on("end", () => {
        result.fileBuffer = Buffer.concat(chunks);
        result.fileName = filename || "document.pdf";
      });
    });

    bb.on("field", (fieldname, value) => {
      result.fields[fieldname] = value;
    });

    bb.on("error", reject);
    bb.on("finish", () => resolve(result));

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf8");

    bb.end(body);
  });
}
