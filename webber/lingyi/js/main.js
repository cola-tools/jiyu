/* 轻量化独居老人大数据监护助手项目 - 主JavaScript文件 */
/* 作者：XXX团队 创建时间：2026年 */

// 全局变量定义
let currentTheme = 'light';
let mobileMenuOpen = false;

// 初始化函数
function init() {
    initializeTheme();
    setupMobileMenu();
    setupEventListeners();
}

// 初始化主题
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
}

// 设置主题
function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    // 更新主题切换按钮状态
    updateThemeToggle();
}

// 切换主题
function toggleTheme() {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}

// 更新主题切换按钮
function updateThemeToggle() {
    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) {
        const sun = themeToggle.querySelector('.sun');
        const moon = themeToggle.querySelector('.moon');
        
        if (currentTheme === 'light') {
            sun.style.opacity = '1';
            moon.style.opacity = '0';
        } else {
            sun.style.opacity = '0';
            moon.style.opacity = '1';
        }
    }
}

// 设置移动端菜单
function setupMobileMenu() {
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const mobileMenu = document.querySelector('.mobile-menu');
    
    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.addEventListener('click', function() {
            mobileMenuOpen = !mobileMenuOpen;
            if (mobileMenuOpen) {
                mobileMenu.classList.add('active');
                mobileMenuBtn.innerHTML = '<i class="fas fa-times"></i>';
            } else {
                mobileMenu.classList.remove('active');
                mobileMenuBtn.innerHTML = '<i class="fas fa-bars"></i>';
            }
        });
        
        // 点击菜单项关闭菜单
        const mobileLinks = mobileMenu.querySelectorAll('.nav-link');
        mobileLinks.forEach(link => {
            link.addEventListener('click', function() {
                mobileMenuOpen = false;
                mobileMenu.classList.remove('active');
                mobileMenuBtn.innerHTML = '<i class="fas fa-bars"></i>';
            });
        });
    }
}

// 设置事件监听器
function setupEventListeners() {
    // 窗口调整大小
    window.addEventListener('resize', () => {
        // 重新计算移动端菜单状态
        if (window.innerWidth > 768) {
            mobileMenuOpen = false;
            const mobileMenu = document.querySelector('.mobile-menu');
            const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
            if (mobileMenu) mobileMenu.classList.remove('active');
            if (mobileMenuBtn) mobileMenuBtn.innerHTML = '<i class="fas fa-bars"></i>';
        }
    });
    
    // 主题切换按钮
    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // 友情链接点击事件
    const friendLinksToggle = document.getElementById('friendLinksToggle');
    const friendLinksMenu = document.getElementById('friendLinksMenu');
    
    if (friendLinksToggle && friendLinksMenu) {
        friendLinksToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const isActive = friendLinksMenu.classList.contains('active');
            
            // 关闭其他可能打开的下拉菜单
            document.querySelectorAll('.friend-links-menu.active').forEach(menu => {
                if (menu !== friendLinksMenu) {
                    menu.classList.remove('active');
                }
            });
            
            if (isActive) {
                friendLinksMenu.classList.remove('active');
                friendLinksToggle.classList.remove('active');
            } else {
                friendLinksMenu.classList.add('active');
                friendLinksToggle.classList.add('active');
            }
        });
        
        // 点击页面其他地方关闭下拉菜单
        document.addEventListener('click', function() {
            friendLinksMenu.classList.remove('active');
            friendLinksToggle.classList.remove('active');
        });
        
        // 阻止下拉菜单内部点击事件冒泡
        friendLinksMenu.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
    
    // 平滑滚动
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // 导航链接激活状态
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            navLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

// 工具函数：防抖
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 工具函数：节流
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

// 导出函数供其他文件使用
window.App = {
    setTheme,
    setLanguage,
    toggleTheme,
    toggleLanguage,
    currentLanguage: () => currentLanguage,
    currentTheme: () => currentTheme
};