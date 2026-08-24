const cvPromise = new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = '/vendor/opencv-js/opencv.js';
  script.onload = () => {
    const check = () => {
      if (typeof globalThis.cv !== 'undefined' && typeof globalThis.cv.Mat === 'function') {
        const cv = globalThis.cv;
        delete cv.then;
        resolve(cv);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  };
  script.onerror = () => reject(new Error('opencv.js 載入失敗'));
  document.head.appendChild(script);
});

export default cvPromise;
