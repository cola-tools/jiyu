// ====================== 安全防护模块 ======================
// 功能说明：禁用鼠标操作、屏蔽开发者工具快捷键、防止内容盗取
// 运维说明：如需放开某一项防护，注释对应代码块即可
// 注意：前端防护为基础安全措施，无法完全杜绝专业技术人员逆向

// 1. 全局禁用鼠标右键菜单
document.addEventListener('contextmenu', function(e) {
    e.preventDefault(); // 阻止浏览器默认右键菜单弹出
    return false;
});

// 2. 禁用鼠标中键（滚轮按键），防止中键打开新标签页、中键拖拽等操作
document.addEventListener('mousedown', function(e) {
    // 鼠标按键编码：0=左键 1=中键 2=右键
    if (e.button === 1) {
        e.preventDefault(); // 阻止中键默认行为
        return false;
    }
});

// 3. 屏蔽开发者工具与查看源码相关快捷键
// 覆盖F12、FN+F12、Ctrl+Shift+I、Ctrl+Shift+J、Ctrl+U、Ctrl+S
document.addEventListener('keydown', function(e) {
    // 屏蔽F12键（FN+F12在系统层面会映射为F12按键事件，因此同步生效）
    if (e.keyCode === 123) {
        e.preventDefault();
        return false;
    }
    // 屏蔽 Ctrl+Shift+I：打开开发者工具元素面板
    if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
        e.preventDefault();
        return false;
    }
    // 屏蔽 Ctrl+Shift+J：打开开发者工具控制台
    if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
        e.preventDefault();
        return false;
    }
    // 屏蔽 Ctrl+U：查看网页源码
    if (e.ctrlKey && e.keyCode === 85) {
        e.preventDefault();
        return false;
    }
    // 屏蔽 Ctrl+S：保存网页到本地
    if (e.ctrlKey && e.keyCode === 83) {
        e.preventDefault();
        return false;
    }
});

// 4. 全局禁止元素拖拽，防止图片、视频拖拽到桌面保存
document.addEventListener('dragstart', function(e) {
    e.preventDefault();
    return false;
});

// ====================== 原有业务逻辑（完全保留） ======================
// DOM 元素获取
const cursorFollower = document.getElementById('cursorFollower');
const tipModal = document.getElementById('tipModal');
const countdownNum = document.getElementById('countdownNum');
const transitionOverlay = document.getElementById('transitionOverlay');
const serviceBtns = document.querySelectorAll('.service-btn');
const bgVideo = document.querySelector('.bg-video');
const mainContainer = document.querySelector('.main-container');

// ====================== 1. 设备检测 ======================
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouchDevice) {
    cursorFollower.style.display = 'none';
}

// ====================== 2. 鼠标跟随圆圈 ======================
if (!isTouchDevice) {
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let followerX = mouseX;
    let followerY = mouseY;

    // 监听鼠标位置
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    // 平滑缓动跟随
    function animateCursor() {
        followerX += (mouseX - followerX) * 0.18;
        followerY += (mouseY - followerY) * 0.18;
        cursorFollower.style.left = `${followerX}px`;
        cursorFollower.style.top = `${followerY}px`;
        requestAnimationFrame(animateCursor);
    }
    animateCursor();

    // 鼠标按下变色
    document.addEventListener('mousedown', () => {
        cursorFollower.classList.add('active');
    });

    // 鼠标松开恢复
    document.addEventListener('mouseup', () => {
        cursorFollower.classList.remove('active');
    });

    // 全局视差效果 增强裸眼3D
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

// ====================== 3. 进入浮窗倒计时 ======================
let countdown = 5;

function runCountdown() {
    countdownNum.textContent = countdown;
    // 到1秒时直接关闭 不到0秒
    if (countdown <= 1) {
        tipModal.classList.add('hidden');
        return;
    }
    countdown--;
    setTimeout(runCountdown, 1000);
}

// ====================== 4. 页面加载初始化 ======================
window.addEventListener('load', () => {
    // 确保视频自动播放 兼容各浏览器
    // 运维说明：浏览器会自动根据当前屏幕宽度选择对应source的视频
    const playPromise = bgVideo.play();
    if (playPromise !== undefined) {
        playPromise.catch(() => {
            console.log('视频自动播放被浏览器拦截，已显示静态深色背景');
        });
    }
    
    // 延迟启动倒计时
    setTimeout(runCountdown, 600);
});

// ====================== 5. 按钮跳转过渡效果 ======================
serviceBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetUrl = btn.href;
        const isBlank = btn.target === '_blank';
        
        // 触发渐暗过渡
        transitionOverlay.classList.add('show');
        
        setTimeout(() => {
            if (isBlank) {
                // 新标签页打开
                window.open(targetUrl, '_blank');
                // 恢复当前页面
                setTimeout(() => {
                    transitionOverlay.classList.remove('show');
                }, 400);
            } else {
                // 当前页跳转
                window.location.href = targetUrl;
            }
        }, 300);
    });
});