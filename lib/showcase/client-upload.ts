"use client";

export async function inspectShowcaseFile(file: File): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("video/")) {
      return await new Promise((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve({
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
          durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : undefined,
        });
        video.onerror = () => resolve({});
        video.src = url;
      });
    }
    if (file.type.startsWith("image/")) {
      return await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({});
        image.src = url;
      });
    }
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function uploadShowcaseMediaWithProgress(
  url: string,
  fields: Record<string, string | number>,
  file: File,
  onProgress: (value: number) => void,
) {
  return new Promise<Record<string, any>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
    form.append("file", file);
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let response: Record<string, any> = {};
      try { response = JSON.parse(xhr.responseText || "{}"); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && response?.secure_url) resolve(response);
      else reject(new Error(response?.error?.message || `CLOUDINARY_UPLOAD_HTTP_${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("CLOUDINARY_UPLOAD_NETWORK_ERROR"));
    xhr.onabort = () => reject(new Error("CLOUDINARY_UPLOAD_ABORTED"));
    xhr.send(form);
  });
}
