import { failure, success, type Result } from "../../shared/result";
import {
  EFFECT_REGISTRY,
  getStorageKey,
  type ErasedSettings,
} from "./registry";
import type { EffectView } from "./types";

export type PersistedEffectSettings = Readonly<Record<string, ErasedSettings>>;

function getStorage(): Result<Storage> {
  try {
    return success(window.localStorage);
  } catch {
    return failure({
      code: "INTERNAL",
      message: "Effect settings are unavailable in this browser.",
    });
  }
}

/** Reads each distinct settings store once and files entries by effect ID. */
export function readPersistedEffectSettings(): {
  readonly settings: PersistedEffectSettings;
  readonly error: string;
} {
  const storage = getStorage();
  if (!storage.ok) return { settings: {}, error: storage.error.message };
  const settings: Record<string, ErasedSettings> = {};
  let error = "";
  const stores = new Set(
    EFFECT_REGISTRY.flatMap(({ view }) =>
      view.settingsStore ? [view.settingsStore] : [],
    ),
  );
  for (const store of stores) {
    const result = store.read(storage.value);
    if (!result.ok) {
      error = result.error.message;
      continue;
    }
    for (const { view } of EFFECT_REGISTRY) {
      const saved =
        view.settingsStore === store
          ? result.value[getStorageKey(view)]
          : undefined;
      if (saved) settings[view.id] = saved;
    }
  }
  return { settings, error };
}

/** Writes every persisted entry that shares the view's store. */
export function persistEffectSettings(
  view: EffectView<ErasedSettings>,
  entries: PersistedEffectSettings,
): Result<undefined> {
  const store = view.settingsStore;
  if (!store) return success(undefined);
  const storage = getStorage();
  if (!storage.ok) return storage;
  // Entries saved under keys this build does not know are carried forward.
  const existing = store.read(storage.value);
  const shared: Record<string, ErasedSettings> = existing.ok
    ? { ...existing.value }
    : {};
  for (const { view: sibling } of EFFECT_REGISTRY) {
    const value = entries[sibling.id];
    if (sibling.settingsStore === store && value) {
      shared[getStorageKey(sibling)] = value;
    }
  }
  return store.write(storage.value, shared);
}
