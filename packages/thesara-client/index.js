
function createStorageClient({ authToken, appId, apiBaseUrl = '/api' }) {
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'X-Thesara-App-Id': appId,
    'Content-Type': 'application/json',
  };

  return {
    async getItem(key) {
      const response = await fetch(`${apiBaseUrl}/storage/item?key=${encodeURIComponent(key)}`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`Failed to get item: ${response.statusText}`);
      }
      const { value } = await response.json();
      return value;
    },
    async setItem(key, value) {
      const response = await fetch(`${apiBaseUrl}/storage/item`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) {
        throw new Error(`Failed to set item: ${response.statusText}`);
      }
    },
    async removeItem(key) {
      const response = await fetch(`${apiBaseUrl}/storage/item`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ key }),
      });
      if (!response.ok) {
        throw new Error(`Failed to remove item: ${response.statusText}`);
      }
    },
  };
}

function createMockStorageClient() {
  // Using localStorage for persistence during development session
  return {
    async getItem(key) {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : undefined;
    },
    async setItem(key, value) {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    async removeItem(key) {
      window.localStorage.removeItem(key);
    },
  };
}

function initializeThesara() {
  return new Promise((resolve, reject) => {
    // If not in an iframe, resolve with a client for standalone development.
    if (window.self === window.top) {
      console.warn('Thesara client is running in standalone mode. Using dev storage client.');
      const storageClient = createStorageClient({
        authToken: 'dev-token', // This will be ignored by the modified auth middleware
        appId: 'pub-quiz', // A default app ID
        apiBaseUrl: 'http://localhost:8788'
      });
      return resolve(storageClient);
    }

    const timeout = setTimeout(() => {
      reject(new Error('Thesara host did not respond in time.'));
    }, 5000);

    function handleMessage(event) {
      if (event.data && event.data.type === 'THESARA_INIT') {
        clearTimeout(timeout);
        window.removeEventListener('message', handleMessage);
        const storageClient = createStorageClient(event.data.payload);
        resolve(storageClient);
      }
    }

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: 'THESARA_READY' }, '*');
  });
}

module.exports = { initializeThesara };
