// ====================== بىخەتەرلىك مۇداپىئە مودۇلى ======================
// 1. ئوڭ تامچىنى چەكلەش
document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
});

// 2. ئوتتۇرا تامچىنى چەكلەش
document.addEventListener('mousedown', function(e) {
    if (e.button === 1) {
        e.preventDefault();
        return false;
    }
});

// 3. ئىجرا قىلىش قورالى توختاملىرىنى چەكلەش
document.addEventListener('keydown', function(e) {
    // F12 توختامى
    if (e.keyCode === 123) {
        e.preventDefault();
        return false;
    }
    // Ctrl+Shift+I
    if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
        e.preventDefault();
        return false;
    }
    // Ctrl+Shift+J
    if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
        e.preventDefault();
        return false;
    }
    // Ctrl+U مەنبە كودى
    if (e.ctrlKey && e.keyCode === 85) {
        e.preventDefault();
        return false;
    }
    // Ctrl+S ساقلاش
    if (e.ctrlKey && e.keyCode === 83) {
        e.preventDefault();
        return false;
    }
});

// 4. سۆرەپ ساقلاشنى چەكلەش
document.addEventListener('dragstart', function(e) {
    e.preventDefault();
    return false;
});

// ====================== ئەسلى ئىشلىتىش لىگىكى ======================
const cursorFollower = document.getElementById('cursorFollower');
const tipModal = document.getElementById('tipModal');
const countdownNum = document.getElementById('countdownNum');
const transitionOverlay = document.getElementById('transitionOverlay');
const serviceBtns = document.querySelectorAll('.service-btn');
const langBtn = document.querySelector('.lang-btn');
const bgVideo = document.querySelector('.bg-video');
const mainContainer = document.querySelector('.main-container');

// 1. ئۈسكۈنى تەكشۈرۈش
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouchDevice) {
    cursorFollower.style.display = 'none';
}

// 2. تامچە ئەگەشكۈچى چەمبىرەك
if (!isTouchDevice) {
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let followerX = mouseX;
    let followerY = mouseY;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    function animateCursor() {
        followerX += (mouseX - followerX) * 0.18;
        followerY += (mouseY - followerY) * 0.18;
        cursorFollower.style.left = `${followerX}px`;
        cursorFollower.style.top = `${followerY}px`;
        requestAnimationFrame(animateCursor);
    }
    animateCursor();

    document.addEventListener('mousedown', () => {
        cursorFollower.classList.add('active');
    });

    document.addEventListener('mouseup', () => {
        cursorFollower.classList.remove('active');
    });

    // 3D كۆرۈش ئەسىرى
    document.addEventListener('mousemove', (e) => {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const offsetX = (e.clientX - centerX) / centerX;
        const offsetY = (e.clientY - centerY) / centerY;
        
        mainContainer.style.transform = `
            perspective(1000px)
            rotateY(${offsetX * 1.5}deg)
            rotateX(${-offsetY * 1.5}deg)
        `;
    });
}

// 3. كىرىش ئەسىرى سانى ئازايتىش
let countdown = 5;

function runCountdown() {
    countdownNum.textContent = countdown;
    if (countdown <= 1) {
        tipModal.classList.add('hidden');
        return;
    }
    countdown--;
    setTimeout(runCountdown, 1000);
}

// 4. بېت ئوقۇلغانلىقىدا باشلىنىش
window.addEventListener('load', () => {
    const playPromise = bgVideo.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            console.log('سىن ئۆزىلا ئويناشنى تور كۆرگۈ بىكار قىلدى');
        });
    }
    
    setTimeout(runCountdown, 600);
});

// 5. توپچى ئۆتۈش ئەسىرى
serviceBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetUrl = btn.href;
        const isBlank = btn.target === '_blank';
        
        transitionOverlay.classList.add('show');
        
        setTimeout(() => {
            if (isBlank) {
                window.open(targetUrl, '_blank');
                setTimeout(() => {
                    transitionOverlay.classList.remove('show');
                }, 400);
            } else {
                window.location.href = targetUrl;
            }
        }, 300);
    });
});

// ====================== 6. تىل ئالماشتۇرۇش ئەسىرى（新增） ======================
if (langBtn) {
    langBtn.addEventListener('click', function(e) {
        e.preventDefault();
        const targetUrl = this.href;
        transitionOverlay.classList.add('show');
        setTimeout(() => {
            window.location.href = targetUrl;
        }, 300);
    });
}