const loadedFamilies = new Set<string>();

export function markFamilyLoaded(family: string): void {
  loadedFamilies.add(family);
}

export function runtimeStateSnapshot(): { loaded_families: string[] } {
  return { loaded_families: [...loadedFamilies].sort() };
}
