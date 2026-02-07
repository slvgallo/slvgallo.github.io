// Environment detection with fallback
// Extracted from index.js window.slvEnv usage

export function getEnvironment() {
  // Return the environment if defined, otherwise fallback to 'development'
  return window.slvEnv || 'development';
}

export function generateWorkLink(workId) {
  // Exact logic from index.js line 174-178
  const env = getEnvironment();
  if (env === 'static') {
    return `works/${workId}.html`;
  } else {
    return `works.html?id=${workId}`;
  }
}
