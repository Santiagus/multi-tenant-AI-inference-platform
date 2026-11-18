/**
 * Strips verbose vendor and trademark prefixes ("NVIDIA", "NVIDIA RTX", "NVIDIA GeForce RTX", "RTX")
 * so hardware displays cleanly in tables and charts (e.g. "5070 Ti", "H100 SXM5 80GB").
 */
export function cleanHardwareName(rawName?: string, vramGb?: number): string {
  if (!rawName) return vramGb ? `GPU (${vramGb}GB)` : 'Standard GPU';
  let cleaned = rawName
    .replace(/^NVIDIA\s+GeForce\s+RTX\s+/i, '')
    .replace(/^NVIDIA\s+RTX\s+/i, '')
    .replace(/^NVIDIA\s+GeForce\s+/i, '')
    .replace(/^NVIDIA\s+/i, '')
    .replace(/\bRTX\s+/i, '')
    .trim();

  // Strip redundant trailing VRAM size on consumer models (e.g. "3090 24GB" -> "3090")
  if (/^(30\d\d|40\d\d|50\d\d)\s+\d+GB$/i.test(cleaned)) {
    cleaned = cleaned.replace(/\s+\d+GB$/i, '');
  }

  return cleaned || 'GPU';
}
