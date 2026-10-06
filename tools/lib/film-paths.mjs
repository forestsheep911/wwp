import path from "node:path";

export function isWindowsPath(value) {
  return /^[a-z]:[\\/]|^\\\\/iu.test(String(value));
}

export function comparablePath(value) {
  const raw = String(value ?? "");
  return isWindowsPath(raw)
    ? path.win32.normalize(raw).replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()
    : path.posix.normalize(raw).replace(/\/+$/u, "");
}

export function pathIsWithin(file, root, includeRoot = true) {
  const child = comparablePath(file), parent = comparablePath(root);
  return (includeRoot && child === parent) || child.startsWith(`${parent}/`);
}

export function sourceIsDescendant(child, parent) {
  if (child.id === parent.id) return false;
  if (child.absolute_path && parent.absolute_path && pathIsWithin(child.absolute_path, parent.absolute_path, false)) return true;
  const windows = isWindowsPath(parent.absolute_path);
  const relative = value => {
    const normalized = String(value ?? "").replaceAll("\\", "/").replace(/\/+$/u, "");
    return windows ? normalized.toLowerCase() : normalized;
  };
  const prefix = relative(parent.relative_path);
  return Boolean(prefix) && relative(child.relative_path).startsWith(`${prefix}/`);
}
