"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-client";

export default function MediaLibraryPage() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading media library…</p>
      </div>
    );
  }

  if (!session) {
    router.push("/login");
    return null;
  }

  const organisation = session.organisation;
  const user = session.user;

  async function handleUpload(event) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setUploading(true);

    try {
      const form = event.target;
      const fileInput = form.file;
      const nameInput = form.name;
      const mediaTypeInput = form.mediaType;
      const durationInput = form.durationSeconds;

      if (!fileInput.files || fileInput.files.length === 0) {
        throw new Error("Please select an audio file");
      }

      const file = fileInput.files[0];
      const name = nameInput.value.trim() || file.name;
      const mediaType = mediaTypeInput.value;
      const durationSeconds = durationInput.value
        ? Number(durationInput.value)
        : null;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("organisationId", organisation.id);
      formData.append("name", name);
      formData.append("mediaType", mediaType);
      if (durationSeconds) {
        formData.append("durationSeconds", String(durationSeconds));
      }

      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setResult(data);
      form.reset();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Media Library</h1>

      <div className="max-w-xl">
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Audio file
            </label>
            <input
              type="file"
              name="file"
              accept="audio/*"
              required
              disabled={uploading}
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Name (optional)
            </label>
            <input
              type="text"
              name="name"
              placeholder="e.g. Morning Jingle"
              disabled={uploading}
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Type
            </label>
            <select
              name="mediaType"
              defaultValue="MUSIC"
              disabled={uploading}
              className="w-full border rounded px-3 py-2"
            >
              <option value="MUSIC">Music</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="JINGLE">Jingle</option>
              <option value="ANNOUNCEMENT">Announcement</option>
              <option value="VOICEOVER">Voiceover</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Duration (seconds, optional)
            </label>
            <input
              type="number"
              name="durationSeconds"
              min="1"
              placeholder="e.g. 30"
              disabled={uploading}
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <button
            type="submit"
            disabled={uploading}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-3 border border-red-300 bg-red-50 text-red-700 rounded">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 p-3 border border-green-300 bg-green-50 text-green-700 rounded">
            <p className="font-medium">Upload successful</p>
            <ul className="mt-2 text-sm">
              <li>Name: {result.name}</li>
              <li>Type: {result.mediaType}</li>
              <li>Size: {Number(result.sizeBytes).toLocaleString()} bytes</li>
              {result.durationSeconds && (
                <li>Duration: {result.durationSeconds} s</li>
              )}
              <li>
                Playback URL:{" "}
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {result.url}
                </a>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
