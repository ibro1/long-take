import { MMKV } from "react-native-mmkv";

/**
 * Where destinations, settings and preferences are kept.
 *
 * Two things about this store are security decisions rather than defaults,
 * because a destination carries an endpoint and a stream key - the one
 * credential on this phone that lets somebody else broadcast as the operator.
 *
 * The first is dealt with. MMKV writes to `files/mmkv/`, which Android's
 * automatic backup would copy to the operator's Google Drive and hand to the
 * next phone in a device-to-device transfer; `plugins/with-backup-rules.js`
 * excludes that directory from both. A stream key should not leave the device
 * because somebody set up a new phone.
 *
 * The second is not. This store is unencrypted, so the keys are readable to
 * anything that can already read the app's data directory.
 *
 * TODO: pass `encryptionKey` to this constructor. The key has to be made once
 * per install and kept somewhere MMKV is not, which means `expo-secure-store`
 * and the Android keystore behind it - not a dependency of this app today, and
 * the package that holds the credential store is not one to add without
 * looking at it. It also has to migrate in one go: `new MMKV({ encryptionKey })`
 * cannot read an existing unencrypted store, so the values have to be read out
 * plain and written back encrypted on the update that turns it on, or the
 * operator opens the app to no saved destinations.
 */
export const storage = new MMKV();

export function getItem<T>(key: string): T | null {
  const value = storage.getString(key);
  try {
    return value ? JSON.parse(value) || null : null;
  } catch (error) {
    // Handle the error here
    console.error("Error parsing JSON:", error);
    return null;
  }
}

export function setItem<T>(key: string, value: T) {
  storage.set(key, JSON.stringify(value));
}

export function removeItem(key: string) {
  storage.delete(key);
}
