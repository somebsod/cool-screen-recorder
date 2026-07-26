const recordZone = document.getElementById('record-zone');
const statusText = document.getElementById('status-text');
const previewContainer = document.getElementById('preview-container');
const previewVideo = document.getElementById('preview-video');
const downloadLink = document.getElementById('download-link');

let mediaRecorder;
let recordedChunks = [];
let audioContext;
let isRecording = false;
let canvasRenderInterval;

// ТВОЙ ТЕКСТ ССЫЛКИ ДЛЯ ЗАПИСИ (измени его здесь)
const WATERMARK_TEXT = "https://somebsod.github.io/cool-screen-recorder/";

recordZone.addEventListener('click', async () => {
    if (isRecording) {
        mediaRecorder.stop();
        return;
    }

    try {
        // 1. Запрашиваем микрофон
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // 2. Запрашиваем экран (360p, 15 FPS)
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 640 },  
                height: { ideal: 360 },
                frameRate: { ideal: 15 } 
            },
            audio: true
        });

        statusText.innerText = "RECORDING... CLICK TO STOP";
        isRecording = true;

        // 3. Создаем невидимый плеер для захвата кадров и Canvas для рисования ссылки
        const videoElement = document.createElement('video');
        videoElement.srcObject = screenStream;
        videoElement.autoplay = true;
        videoElement.playsInline = true;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Жестко выставляем размер кадра 360p для записи
        canvas.width = 640;
        canvas.height = 360;

        // Рендер-петля: берем кадр с экрана, жмем до 360p и рисуем текст сверху
        videoElement.onloadedmetadata = () => {
            canvasRenderInterval = setInterval(() => {
                if (videoElement.readyState >= 2) {
                    // Рисуем текущий кадр экрана, растягивая/сжимая его под 360p
                    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                    
                    // Настройки полупрозрачного текста ссылки наверху видео
                    ctx.fillStyle = "rgba(255, 255, 255, 0.7)"; 
                    ctx.font = "bold 14px 'Courier New', monospace";
                    ctx.textAlign = "center";
                    
                    // Рисуем текст по центру сверху (с небольшим отступом в 25 пикселей)
                    ctx.fillText(WATERMARK_TEXT, canvas.width / 2, 25);
                }
            }, 1000 / 15); // Обновляем строго 15 раз в секунду
        };

        // Захватываем видеопоток с холста (тоже 15 FPS)
        const canvasStream = canvas.captureStream(15);

        // 4. Ломаем звук через Web Audio API
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const destination = audioContext.createMediaStreamDestination();

        // Микрофон: +20дБ и жесткий хрип
        const micSource = audioContext.createMediaStreamSource(micStream);
        const micGain = audioContext.createGain();
        micGain.gain.value = 3; 

        const waveshaper = audioContext.createWaveShaper();
        waveshaper.curve = makeDistortionCurve(400); 
        waveshaper.oversample = '3x';

        micSource.connect(micGain);
        micGain.connect(waveshaper);
        waveshaper.connect(destination);

        // Системный звук: эффект дешевых колонок и эха
        if (screenStream.getAudioTracks().length > 0) {
            const systemSource = audioContext.createMediaStreamSource(screenStream);
            
            const hpFilter = audioContext.createBiquadFilter();
            hpFilter.type = 'highpass';
            hpFilter.frequency.value = 400; 

            const bpFilter = audioContext.createBiquadFilter();
            bpFilter.type = 'peaking';
            bpFilter.frequency.value = 2500;
            bpFilter.Q.value = 3;
            bpFilter.gain.value = 15;

            const delay = audioContext.createDelay();
            delay.delayTime.value = 0.015; 
            const delayGain = audioContext.createGain();
            delayGain.gain.value = 0.4;

            systemSource.connect(hpFilter);
            hpFilter.connect(bpFilter);
            
            bpFilter.connect(destination);
            bpFilter.connect(delay);
            delay.connect(delayGain);
            delayGain.connect(destination);
        }

        // 5. Собираем треки (видео берем с CANVAS, а звук из деструктора аудио)
        const mixedTracks = [
            ...canvasStream.getVideoTracks(),
            ...destination.stream.getAudioTracks()
        ];
        const combinedStream = new MediaStream(mixedTracks);

        // Ограничиваем битрейт для эффекта пиксельного "мыла"
        const options = {
            mimeType: 'video/webm;codecs=vp8,opus', 
            videoBitsPerSecond: 400000 
        };

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(combinedStream, options);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            statusText.innerText = "CLICK HERE TO RECORD";
            isRecording = false;

            // Останавливаем интервал рисования и железки
            clearInterval(canvasRenderInterval);
            screenStream.getTracks().forEach(track => track.stop());
            micStream.getTracks().forEach(track => track.stop());
            videoElement.srcObject = null;
            audioContext.close();

            // Сохраняем результат
            const blob = new Blob(recordedChunks, { type: 'video/mp4' });
            const videoURL = URL.createObjectURL(blob);

            // Показываем плеер
            previewVideo.src = videoURL;
            downloadLink.href = videoURL;
            downloadLink.download = `cool_recording_${Date.now()}.mp4`;
            previewContainer.style.display = 'block';
            
            previewContainer.scrollIntoView({ behavior: 'smooth' });
        };

        mediaRecorder.start();

        screenStream.getVideoTracks().onended = () => {
            if (mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
            }
        };

    } catch (err) {
        console.error(err);
        alert("Запись сорвалась. Проверь доступы!");
        statusText.innerText = "CLICK HERE TO RECORD";
        isRecording = false;
        clearInterval(canvasRenderInterval);
    }
});

function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}
