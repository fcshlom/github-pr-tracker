const state = {
  sync: {},
  local: {},
  cookies: {},
};

function storageArea(bucket) {
  return {
    async get(defaults) {
      const source = state[bucket];
      if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
        return { ...defaults, ...source };
      }
      return { ...source };
    },
    async set(values) {
      Object.assign(state[bucket], values);
    },
    async remove(key) {
      delete state[bucket][key];
    },
  };
}

globalThis.chrome = {
  storage: {
    sync: storageArea("sync"),
    local: storageArea("local"),
  },
  cookies: {
    async get({ name }) {
      const value = state.cookies[name];
      return value === undefined ? null : { name, value };
    },
  },
};

export function resetChrome() {
  state.sync = {};
  state.local = {};
  state.cookies = {};
}

export function seedLocal(values) {
  Object.assign(state.local, values);
}

export function setCookie(name, value) {
  state.cookies[name] = value;
}
