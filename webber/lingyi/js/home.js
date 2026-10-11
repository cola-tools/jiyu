/* 轻量化独居老人大数据监护助手项目 - 首页JavaScript文件 */
/* 作者：XXX团队 创建时间：2026年 */

// 首页特定功能初始化
function initHomePage() {
    initializeProgressBars();
    setupHomeInteractions();
    setupScrollAnimations();
    updateProgressDisplay();
}

// 初始化进度条
function initializeProgressBars() {
    const progressItems = document.querySelectorAll('.progress-item');
    
    progressItems.forEach((item, index) => {
        // 添加延迟加载动画
        item.style.animationDelay = `${index * 0.1}s`;
        item.classList.add('loading');
        
        // 添加点击交互
        item.addEventListener('click', function() {
            showProgressDetails(this);
        });
    });
    
    // 初始化桌面端进度条
    setupDesktopProgress();
}

// 设置桌面端进度条
function setupDesktopProgress() {
    const desktopProgress = document.querySelector('.desktop-progress');
    if (desktopProgress && window.innerWidth >= 1024) {
        const progressBars = desktopProgress.querySelectorAll('.progress-bar');
        
        progressBars.forEach((bar, index) => {
            // 添加悬停效果
            bar.addEventListener('mouseenter', function() {
                this.style.transform = 'scale(1.02)';
                this.style.transition = 'transform 0.3s ease';
            });
            
            bar.addEventListener('mouseleave', function() {
                this.style.transform = 'scale(1)';
            });
            
            // 添加点击效果
            bar.addEventListener('click', function() {
                const label = this.querySelector('.progress-label').textContent;
                showProgressModal(label, index + 1);
            });
        });
    }
}

// 显示进度详情
function showProgressDetails(element) {
    const progressText = element.querySelector('.progress-text').textContent;
    const progressNumber = element.querySelector('.progress-number').textContent;
    
    // 创建详情弹窗
    const modal = createProgressModal(progressText, progressNumber);
    document.body.appendChild(modal);
    
    // 显示弹窗
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);
    
    // 点击背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeProgressModal(modal);
        }
    });
}

// 创建进度详情弹窗
function createProgressModal(title, step) {
    const modal = document.createElement('div');
    modal.className = 'progress-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="progress-info">
                    <span class="step-number">步骤 ${step}</span>
                    <div class="status-indicator">
                        <span class="status-dot"></span>
                        <span>进行中</span>
                    </div>
                </div>
                <div class="progress-description">
                    <p>这是项目开发过程中的重要阶段，涉及多个关键任务和里程碑。</p>
                    <ul>
                        <li>任务规划与分配</li>
                        <li>技术方案设计</li>
                        <li>资源调配与协调</li>
                        <li>进度监控与调整</li>
                    </ul>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-primary">查看详情</button>
                <button class="btn-secondary">关闭</button>
            </div>
        </div>
    `;
    
    // 添加关闭按钮事件
    const closeBtn = modal.querySelector('.modal-close');
    const secondaryBtn = modal.querySelector('.btn-secondary');
    
    closeBtn.addEventListener('click', () => closeProgressModal(modal));
    secondaryBtn.addEventListener('click', () => closeProgressModal(modal));
    
    return modal;
}

// 关闭进度弹窗
function closeProgressModal(modal) {
    modal.classList.remove('show');
    setTimeout(() => {
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    }, 300);
}

// 设置首页交互
function setupHomeInteractions() {
    // 公告卡片交互
    const announcementCards = document.querySelectorAll('.announcement-card');
    announcementCards.forEach(card => {
        card.addEventListener('click', function() {
            this.classList.toggle('expanded');
        });
        
        // 悬停效果
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // 方案卡片交互
    const planCards = document.querySelectorAll('.plan-card');
    planCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            const icon = this.querySelector('.plan-icon');
            icon.style.transform = 'scale(1.1) rotate(5deg)';
        });
        
        card.addEventListener('mouseleave', function() {
            const icon = this.querySelector('.plan-icon');
            icon.style.transform = 'scale(1) rotate(0deg)';
        });
    });
    
    // 友情链接交互
    const friendLinks = document.querySelectorAll('.friend-link');
    friendLinks.forEach(link => {
        link.addEventListener('mouseenter', function() {
            this.style.transform = 'translateX(5px)';
        });
        
        link.addEventListener('mouseleave', function() {
            this.style.transform = 'translateX(0)';
        });
    });
}

// 设置滚动动画
function setupScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
            }
        });
    }, observerOptions);
    
    // 观察需要动画的元素
    const animateElements = document.querySelectorAll('.announcement-card, .plan-card, .progress-item');
    animateElements.forEach(el => {
        observer.observe(el);
    });
}

// 更新进度显示
function updateProgressDisplay() {
    const currentProgress = 1; // 当前进行到第1步
    const totalSteps = 25;
    const progressPercentage = (currentProgress / totalSteps) * 100;
    
    // 更新进度指示器
    const progressIndicator = document.createElement('div');
    progressIndicator.className = 'global-progress';
    progressIndicator.innerHTML = `
        <div class="progress-summary">
            <span>总体进度</span>
            <span class="progress-percent">${Math.round(progressPercentage)}%</span>
        </div>
        <div class="progress-bar-mini">
            <div class="progress-fill-mini" style="width: ${progressPercentage}%"></div>
        </div>
    `;
    
    // 添加到进度区域
    const progressSection = document.querySelector('.progress-section .container');
    if (progressSection) {
        progressSection.insertBefore(progressIndicator, progressSection.querySelector('.progress-container'));
    }
}

// 创建CSS样式（动态添加）
function addHomeStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .progress-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .progress-modal.show {
            opacity: 1;
        }
        
        .modal-content {
            background: var(--bg-card);
            border-radius: 16px;
            padding: 2rem;
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            transform: scale(0.9);
            transition: transform 0.3s ease;
        }
        
        .progress-modal.show .modal-content {
            transform: scale(1);
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-light);
        }
        
        .modal-header h3 {
            margin: 0;
            color: var(--text-primary);
        }
        
        .modal-close {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: var(--text-muted);
            transition: color 0.3s ease;
        }
        
        .modal-close:hover {
            color: var(--primary-red);
        }
        
        .progress-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        
        .step-number {
            background: var(--primary-blue);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-weight: 600;
        }
        
        .status-indicator {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--primary-orange);
            font-weight: 600;
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            background: var(--primary-orange);
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        
        .progress-description {
            color: var(--text-secondary);
            line-height: 1.6;
        }
        
        .progress-description ul {
            margin: 1rem 0;
            padding-left: 1.5rem;
        }
        
        .progress-description li {
            margin-bottom: 0.5rem;
        }
        
        .modal-footer {
            display: flex;
            gap: 1rem;
            margin-top: 2rem;
        }
        
        .btn-primary, .btn-secondary {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            flex: 1;
        }
        
        .btn-primary {
            background: var(--primary-blue);
            color: white;
        }
        
        .btn-primary:hover {
            background: var(--primary-purple);
        }
        
        .btn-secondary {
            background: var(--bg-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-light);
        }
        
        .btn-secondary:hover {
            background: var(--bg-tertiary);
        }
        
        .global-progress {
            background: var(--bg-card);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
            border: 1px solid var(--border-light);
        }
        
        .progress-summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .progress-percent {
            color: var(--primary-blue);
            font-size: 1.2rem;
        }
        
        .progress-bar-mini {
            height: 6px;
            background: var(--border-light);
            border-radius: 3px;
            overflow: hidden;
        }
        
        .progress-fill-mini {
            height: 100%;
            background: var(--gradient-tech);
            border-radius: 3px;
            transition: width 0.6s ease;
        }
        
        .animate-in {
            animation: slideInUp 0.6s ease forwards;
        }
        
        @keyframes slideInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @media (max-width: 768px) {
            .modal-content {
                margin: 1rem;
                padding: 1.5rem;
            }
            
            .modal-footer {
                flex-direction: column;
            }
            
            .global-progress {
                padding: 1rem;
            }
        }
    `;
    
    document.head.appendChild(style);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    addHomeStyles();
    initHomePage();
});

// 窗口调整大小处理
window.addEventListener('resize', function() {
    setupDesktopProgress();
});