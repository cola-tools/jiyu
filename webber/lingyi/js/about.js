/* 轻量化独居老人大数据监护助手项目 - 关于我们页面JavaScript文件 */
/* 作者：XXX团队 创建时间：2026年 */

// 初始化页面
function initAboutPage() {
    setupAboutInteractions();
    setupScrollAnimations();
    animateSkillBars();
    setupDownloadFunctionality();
    animateStats();
}

// 设置关于页面交互
function setupAboutInteractions() {
    // 统计卡片交互
    const statItems = document.querySelectorAll('.stat-item');
    statItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
        });
        
        item.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // 视觉卡片交互
    const visualCards = document.querySelectorAll('.visual-card');
    visualCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-6px) scale(1.02)';
            
            const icon = this.querySelector('i');
            icon.style.transform = 'scale(1.1) rotate(5deg)';
            icon.style.color = 'var(--primary-purple)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
            
            const icon = this.querySelector('i');
            icon.style.transform = 'scale(1) rotate(0deg)';
            icon.style.color = 'var(--primary-blue)';
        });
    });
    
    // 技能类别卡片交互
    const skillCategories = document.querySelectorAll('.skill-category');
    skillCategories.forEach(category => {
        category.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
        });
        
        category.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // 要求项目交互
    const requirementItems = document.querySelectorAll('.requirement-item');
    requirementItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            this.style.transform = 'translateX(5px)';
            this.style.background = 'var(--bg-tertiary)';
        });
        
        item.addEventListener('mouseleave', function() {
            this.style.transform = 'translateX(0)';
            this.style.background = 'var(--bg-secondary)';
        });
    });
    
    // 联系卡片交互
    const contactCards = document.querySelectorAll('.contact-card');
    contactCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
        
        // 点击复制联系信息
        card.addEventListener('click', function() {
            const text = this.querySelector('p').textContent;
            copyToClipboard(text);
            showCopySuccess();
        });
    });
}

// 动画技能条
function animateSkillBars() {
    const skillProgresses = document.querySelectorAll('.skill-progress');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const progress = entry.target;
                const width = progress.style.width;
                progress.style.width = '0%';
                
                setTimeout(() => {
                    progress.style.transition = 'width 1.5s ease-in-out';
                    progress.style.width = width;
                }, 100);
                
                observer.unobserve(progress);
            }
        });
    }, { threshold: 0.5 });
    
    skillProgresses.forEach(progress => {
        observer.observe(progress);
    });
}

// 设置下载功能
function setupDownloadFunctionality() {
    const downloadBtn = document.querySelector('.download-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadInterviewGuide);
    }
}

// 下载面试指南
function downloadInterviewGuide() {
    // 创建面试指南内容
    const interviewGuide = createInterviewGuideContent();
    
    // 创建Blob对象
    const blob = new Blob([interviewGuide], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    
    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '轻量化独居老人大数据监护助手-面试指南.docx';
    
    // 触发下载
    document.body.appendChild(a);
    a.click();
    
    // 清理
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    
    // 显示下载成功提示
    showDownloadSuccess();
}

// 创建面试指南内容
function createInterviewGuideContent() {
    return `
轻量化独居老人大数据监护助手项目
面试指南

一、项目介绍
轻量化独居老人大数据监护助手项目是一个基于人工智能和大数据技术的智能监护解决方案，旨在为独居老人提供全方位的健康安全保障。

二、技术岗位要求

1. 前端开发工程师
   - 熟练掌握HTML5、CSS3、JavaScript
   - 熟悉Vue前端框架
   - 具备响应式设计和移动端开发经验
   - 了解前端性能优化和用户体验设计

2. 后端开发工程师
   - 熟练掌握Java/Python/Node.js等后端语言
   - 熟悉Spring Boot框架
   - 具备数据库设计和优化经验
   - 了解微服务架构和分布式系统

3. AI算法工程师
   - 熟练掌握机器学习、深度学习算法
   - 熟悉TensorFlow框架
   - 具备计算机视觉或自然语言处理经验
   - 了解模型部署和优化

4. 数据科学家
   - 熟练掌握数据分析和挖掘技术
   - 熟悉SQL、Python数据分析工具
   - 具备统计分析和数据可视化经验
   - 了解大数据处理平台

三、面试流程

1. 简历筛选（1个工作日内）
2. 技术笔试（在线编程测试）
3. 技术面试（深入技术交流）
4. 综合面试（综合能力线上评估）
5. 录用通知（3个工作日内）

四、技术考察重点

- 编程能力
- 项目经验
- 技术深度
- 问题解决能力
- 团队协作和沟通能力
- 学习能力和技术热情

五、准备建议

1. 基础算法和数据结构
2. 准备项目经验介绍
3. 了解项目相关技术栈
4. 准备技术问题解答
5. 思考职业发展规划

六、联系我们

地址：新疆农业职业技术大学-信息技术分院 / 新疆农业职业技术大学-大数据技术实训室（2104）
邮箱：2171156701@qq.com

期待您的加入，共同为智慧养老事业贡献力量！

轻量化独居老人大数据监护助手项目团队
2026年3月22日
    `;
}

// 复制到剪贴板
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        console.log('信息已复制到剪贴板');
    }).catch(err => {
        console.error('复制失败:', err);
        // 备用方案
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    });
}

// 显示复制成功提示
function showCopySuccess() {
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.innerHTML = `
        <i class="fas fa-check"></i>
        <span>信息已复制到剪贴板</span>
    `;
    
    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .copy-notification {
            position: fixed;
            top: 100px;
            right: 20px;
            background: var(--primary-green);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: var(--shadow-lg);
            display: flex;
            align-items: center;
            gap: 0.5rem;
            z-index: 3000;
            animation: slideInRight 0.3s ease, fadeOut 0.3s ease 2s forwards;
        }
        
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes fadeOut {
            to {
                opacity: 0;
                transform: translateX(100%);
            }
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(notification);
    
    // 3秒后移除
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
        if (style.parentNode) {
            style.parentNode.removeChild(style);
        }
    }, 3000);
}

// 显示下载成功提示
function showDownloadSuccess() {
    const notification = document.createElement('div');
    notification.className = 'download-notification';
    notification.innerHTML = `
        <i class="fas fa-download"></i>
        <span>面试指南下载成功！</span>
    `;
    
    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .download-notification {
            position: fixed;
            top: 100px;
            right: 20px;
            background: var(--primary-blue);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: var(--shadow-lg);
            display: flex;
            align-items: center;
            gap: 0.5rem;
            z-index: 3000;
            animation: slideInRight 0.3s ease, fadeOut 0.3s ease 3s forwards;
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(notification);
    
    // 3秒后移除
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
        if (style.parentNode) {
            style.parentNode.removeChild(style);
        }
    }, 3000);
}

// 数字动画效果
function animateStats() {
    const statNumbers = document.querySelectorAll('.stat-number');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const statNumber = entry.target;
                const target = parseFloat(statNumber.getAttribute('data-target'));
                const duration = 2000; // 2秒动画
                const step = target / (duration / 16); // 每16ms增加的值
                let current = 0;
                
                const timer = setInterval(() => {
                    current += step;
                    if (current >= target) {
                        current = target;
                        clearInterval(timer);
                    }
                    
                    // 格式化显示
                    if (target === 98.5) {
                        statNumber.textContent = current.toFixed(1) + '%';
                    } else {
                        statNumber.textContent = Math.floor(current) + '+';
                    }
                }, 16);
                
                observer.unobserve(statNumber);
            }
        });
    }, { threshold: 0.5 });
    
    statNumbers.forEach(number => observer.observe(number));
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
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                
                // 为技能条添加延迟动画
                if (entry.target.classList.contains('skill-item')) {
                    const skillBar = entry.target.querySelector('.skill-progress');
                    const skillPercent = entry.target.querySelector('.skill-percent');
                    const width = skillBar.style.width;
                    
                    setTimeout(() => {
                        skillBar.style.width = width;
                        skillPercent.style.opacity = '1';
                    }, 200);
                }
            }
        });
    }, observerOptions);
    
    // 观察所有需要动画的元素
    const animatedElements = document.querySelectorAll('.skill-item, .visual-card, .stat-item');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initAboutPage);

// 窗口调整大小处理
window.addEventListener('resize', function() {
    // 重新计算响应式布局
    const visualCards = document.querySelectorAll('.visual-card');
    visualCards.forEach(card => {
        card.style.transform = 'translateY(0) scale(1)';
    });
    
    const contactCards = document.querySelectorAll('.contact-card');
    contactCards.forEach(card => {
        card.style.transform = 'translateY(0)';
    });
});

// 导出函数供全局使用
window.About = {
    downloadInterviewGuide,
    copyToClipboard
};