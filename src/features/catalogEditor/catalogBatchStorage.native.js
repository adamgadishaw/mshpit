import Storage from "expo-sqlite/kv-store";
export const catalogBatchStorage = {
  getItem: key => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
};
