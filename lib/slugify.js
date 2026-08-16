export default function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")        // spaces → dashes
    .replace(/[^\w-]+/g, "")     // remove non-word chars
    .replace(/--+/g, "-")        // collapse multiple dashes
    .replace(/^-+/, "")          // strip leading dashes
    .replace(/-+$/, "");         // strip trailing dashes
}
