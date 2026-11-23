import axios from "axios";

const baseURL = process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:8000/api";

export const api = axios.create({
  baseURL,
  timeout: 15000,
  headers: { Accept: "application/json" },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const detail = error.response?.data?.detail;
    const message = Array.isArray(detail) ? detail.map((item) => item.msg).join(", ") : detail;
    const fallback = error.code === "ECONNABORTED"
      ? `The PayShield API request timed out at ${baseURL}.`
      : error.response
        ? error.message
        : `Cannot reach PayShield API at ${baseURL}. For a physical phone, connect it to the same Wi-Fi as the computer and use the computer's Wi-Fi IPv4 address.`;
    return Promise.reject(new Error(message || fallback));
  },
);

export function uploadImage(asset) {
  const filename = asset.fileName || asset.uri.split("/").pop() || "payment-proof.jpg";
  const extension = filename.split(".").pop()?.toLowerCase();
  const type = extension === "png" ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("file", { uri: asset.uri, name: filename, type });
  return api.post("/payments/upload-screenshot", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });
}
