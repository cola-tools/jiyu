/* 轻量化独居老人大数据监护助手项目 - 团队成员页面JavaScript文件 */
/* 作者：XXX团队 创建时间：2026年 */

// 项目详情数据
const projectDetails = {
    project1: {
        title: '智能健康监护系统',
        content: `
            <div class="project-detail">
                <div class="detail-header">
                    <div class="detail-icon">
                        <i class="fas fa-brain"></i>
                    </div>
                    <div class="detail-info">
                        <h4>智能健康监护系统</h4>
                        <p>国家级重点研发项目 • 2025-2026</p>
                    </div>
                </div>
                
                <div class="detail-content">
                    <div class="project-meta-info">
                        <div class="meta-item">
                            <i class="fas fa-user"></i>
                            <div>
                                <strong>项目负责人</strong>
                                <p>张明 教授</p>
                            </div>
                        </div>
                        <div class="meta-item">
                            <i class="fas fa-calendar"></i>
                            <div>
                                <strong>项目周期</strong>
                                <p>2025年3月 - 2026年12月</p>
                            </div>
                        </div>
                        <div class="meta-item">
                            <i class="fas fa-tag"></i>
                            <div>
                                <strong>项目类型</strong>
                                <p>国家级重点研发计划</p>
                            </div>
                        </div>
                    </div>
                    
                    <h5>项目简介</h5>
                    <p>本项目基于人工智能和大数据技术，开发面向独居老人的智能健康监护系统。系统能够实时监测老人的日常活动状态，通过AI算法智能识别异常情况，并及时发出预警。</p>
                    
                    <h5>技术特色</h5>
                    <ul>
                        <li>基于深度学习的智能行为识别算法</li>
                        <li>多传感器数据融合技术</li>
                        <li>实时大数据处理平台</li>
                        <li>云端协同的智能预警机制</li>
                    </ul>
                    
                    <h5>项目成果</h5>
                    <div class="achievements">
                        <div class="achievement-item">
                            <i class="fas fa-trophy"></i>
                            <div>
                                <strong>技术突破</strong>
                                <p>行为识别准确率达到98.5%</p>
                            </div>
                        </div>
                        <div class="achievement-item">
                            <i class="fas fa-award"></i>
                            <div>
                                <strong>专利成果</strong>
                                <p>申请发明专利3项</p>
                            </div>
                        </div>
                        <div class="achievement-item">
                            <i class="fas fa-users"></i>
                            <div>
                                <strong>应用推广</strong>
                                <p>已在5个社区试点应用</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `
    },
    project2: {
        title: '养老大数据分析平台',
        content: `
            <div class="project-detail">
                <div class="detail-header">
                    <div class="detail-icon">
                        <i class="fas fa-database"></i>
                    </div>
                    <div class="detail-info">
                        <h4>养老大数据分析平台</h4>
                        <p>省部级科研项目 • 2024-2025</p>
                    </div>
                </div>
                
                <div class="detail-content">
                    <div class="project-meta-info">
                        <div class="meta-item">
                            <i class="fas fa-user"></i>
                            <div>
                                <strong>项目负责人</strong>
                                <p>李华 副教授</p>
                            </div>
                        </div>
                        <div class="meta-item">
                            <i class="fas fa-calendar"></i>
                            <div>
                                <strong>项目周期</strong>
                                <p>2024年1月 - 2025年12月</p>
                            </div>
                        </div>
                        <div class="meta-item">
                            <i class="fas fa-tag"></i>
                            <div>
                                <strong>项目类型</strong>
                                <p>省部级科研项目</p>
                            </div>
                        </div>
                    </div>
                    
                    <h5>项目简介</h5>
                    <p>本项目构建了面向养老服务的大数据分析平台，整合多源异构数据，为政府决策、社区服务和家庭监护提供数据支持。</p>
                    
                    <h5>核心功能</h5>
                    <ul>
                        <li>多源数据采集与整合</li>
                        <li>智能数据清洗与预处理</li>
                        <li>可视化数据分析展示</li>
                        <li>预测模型与决策支持</li>
                    </ul>
                    
                    <h5>技术架构</h5>
                    <div class="tech-architecture">
                        <div class="tech-layer">
                            <strong>数据采集层</strong>
                            <p>传感器数据、用户行为数据、环境数据</p>
                        </div>
                        <div class="tech-layer">
                            <strong>数据处理层</strong>
                            <p>分布式计算、实时流处理、数据挖掘</p>
                        </div>
                        <div class="tech-layer">
                            <strong>应用服务层</strong>
                            <p>API接口、可视化展示、智能推荐</p>
                        </div>
                    </div>
                </div>
            </div>
        `
    },
    project3: {
        title: '移动健康应用开发',
        content: `
            <div class="project-detail">
                <div class="detail-header">
                    <div class="detail-icon">
                        <i class="fas fa-mobile-alt"></i>
                    </div>
                    <div class="detail-info">
                        <h4>移动健康应用开发</h4>
                        <p>校企合作项目 • 2023-2024</p>
                    </div>
                </div>
                
                <div class="detail-content">
                    <div class="project-meta-info">
                        <div class="meta-item">
                            <i class="fas fa-user"></i>
                            <div>
                                <strong>项目负责人</strong>
                                <p>王芳 工程师</p>
                            </div>
                        </div>
                        <div class="meta-item">
                            <i class="fas fa-calendar"></i>
                            <div>
                                <strong>项目周期</strong>
                                <p>2023年6月 - 2024年6月</p>
                            </div>
                        </div>
                        <div class="meta-item">
                            <i class="fas fa-tag"></i>
                            <div>
                                <strong>项目类型</strong>
                                <p>校企合作项目</p>
                            </div>
                        </div>
                    </div>
                    
                    <h5>项目简介</h5>
                    <p>本项目开发了面向老年人的友好型健康管理移动应用，结合用户习惯和健康需求，提供个性化的健康管理服务。</p>
                    
                    <h5>应用特色</h5>
                    <div class="app-features">
                        <div class="feature-item">
                            <i class="fas fa-heart"></i>
                            <div>
                                <strong>健康监测</strong>
                                <p>实时监测生理指标和活动数据</p>
                            </div>
                        </div>
                        <div class="feature-item">
                            <i class="fas fa-bell"></i>
                            <div>
                                <strong>智能提醒</strong>
                                <p>用药提醒、运动提醒、健康检查</p>
                            </div>
                        </div>
                        <div class="feature-item">
                            <i class="fas fa-chart-line"></i>
                            <div>
                                <strong>数据分析</strong>
                                <p>健康趋势分析和个性化建议</p>
                            </div>
                        </div>
                        <div class="feature-item">
                            <i class="fas fa-comments"></i>
                            <div>
                                <strong>在线咨询</strong>
                                <p>专业医生在线健康咨询服务</p>
                            </div>
                        </div>
                    </div>
                    
                    <h5>用户体验优化</h5>
                    <ul>
                        <li>大字体、高对比度的界面设计</li>
                        <li>语音交互和语音播报功能</li>
                        <li>一键呼叫紧急联系人</li>
                        <li>离线数据存储和同步</li>
                    </ul>
                </div>
            </div>
        `
    }
};

// 初始化页面
function initTeamPage() {
    setupTeamInteractions();
    setupScrollAnimations();
    addTeamStyles();
}

// 设置团队交互
function setupTeamInteractions() {
    // 成员卡片交互
    const memberCards = document.querySelectorAll('.member-card');
    memberCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px) scale(1.02)';
            
            const photo = this.querySelector('.member-photo img');
            photo.style.transform = 'scale(1.1)';
            photo.style.borderColor = 'var(--primary-purple)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
            
            const photo = this.querySelector('.member-photo img');
            photo.style.transform = 'scale(1)';
            photo.style.borderColor = 'var(--primary-blue)';
        });
        
        // 点击显示成员详情
        card.addEventListener('click', function() {
            const memberName = this.querySelector('h4').textContent;
            showMemberDetail(memberName);
        });
    });
    
    // 指导教师卡片交互
    const instructorCards = document.querySelectorAll('.instructor-card');
    instructorCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
        
        card.addEventListener('click', function() {
            const instructorName = this.querySelector('h4').textContent;
            showInstructorDetail(instructorName);
        });
    });
    
    // 项目卡片交互
    const projectCards = document.querySelectorAll('.project-card');
    projectCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-6px)';
            
            const icon = this.querySelector('.project-icon');
            icon.style.transform = 'scale(1.1) rotate(5deg)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            
            const icon = this.querySelector('.project-icon');
            icon.style.transform = 'scale(1) rotate(0deg)';
        });
    });
}

// 显示项目详情
function showProjectDetail(projectId) {
    const detail = projectDetails[projectId];
    if (!detail) return;
    
    const modal = document.getElementById('projectModal');
    const modalTitle = document.getElementById('projectModalTitle');
    const modalBody = document.getElementById('projectModalBody');
    
    modalTitle.textContent = detail.title;
    modalBody.innerHTML = detail.content;
    
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    
    // 添加关闭事件
    const closeHandler = function(e) {
        if (e.target === modal || e.target.classList.contains('modal-close')) {
            closeProjectModal();
        }
    };
    
    modal.addEventListener('click', closeHandler);
    
    // ESC键关闭
    const escHandler = function(e) {
        if (e.key === 'Escape') {
            closeProjectModal();
        }
    };
    
    document.addEventListener('keydown', escHandler);
    
    // 保存处理器以便移除
    modal._closeHandler = closeHandler;
    document._escHandler = escHandler;
}

// 关闭项目详情弹窗
function closeProjectModal() {
    const modal = document.getElementById('projectModal');
    
    modal.classList.remove('show');
    document.body.style.overflow = '';
    
    // 移除事件监听器
    if (modal._closeHandler) {
        modal.removeEventListener('click', modal._closeHandler);
    }
    if (document._escHandler) {
        document.removeEventListener('keydown', document._escHandler);
    }
    
    // 添加关闭动画
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// 显示成员详情（简化版）
function showMemberDetail(memberName) {
    // 在实际应用中，这里可以显示更详细的成员信息
    console.log('查看成员详情:', memberName);
    // 可以在这里实现更复杂的成员详情展示逻辑
}

// 显示指导教师详情（简化版）
function showInstructorDetail(instructorName) {
    // 在实际应用中，这里可以显示更详细的指导教师信息
    console.log('查看指导教师详情:', instructorName);
    // 可以在这里实现更复杂的指导教师详情展示逻辑
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
                entry.target.classList.add('animate');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // 观察需要动画的元素
    const animateElements = document.querySelectorAll('.member-card, .instructor-card, .project-card');
    animateElements.forEach(el => {
        el.classList.add('scroll-animate');
        observer.observe(el);
    });
}

// 添加团队页面样式
function addTeamStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .project-detail {
            color: var(--text-secondary);
        }
        
        .detail-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-light);
        }
        
        .detail-icon {
            width: 60px;
            height: 60px;
            background: var(--gradient-tech);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.5rem;
        }
        
        .detail-info h4 {
            margin: 0;
            color: var(--text-primary);
            font-size: 1.3rem;
        }
        
        .detail-info p {
            margin: 0.5rem 0 0 0;
            color: var(--text-secondary);
        }
        
        .project-meta-info {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin: 1.5rem 0;
        }
        
        .meta-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem;
            background: var(--bg-secondary);
            border-radius: 8px;
        }
        
        .meta-item i {
            font-size: 1.5rem;
            color: var(--primary-blue);
        }
        
        .meta-item strong {
            display: block;
            color: var(--text-primary);
            margin-bottom: 0.25rem;
        }
        
        .meta-item p {
            margin: 0;
            font-size: 0.9rem;
            color: var(--text-secondary);
        }
        
        .detail-content h5 {
            color: var(--text-primary);
            margin: 1.5rem 0 1rem 0;
            font-size: 1.1rem;
        }
        
        .detail-content ul {
            list-style: none;
            padding: 0;
            margin: 1rem 0;
        }
        
        .detail-content li {
            padding: 0.5rem 0;
            border-bottom: 1px solid var(--border-light);
            position: relative;
            padding-left: 1.5rem;
        }
        
        .detail-content li::before {
            content: '▶';
            position: absolute;
            left: 0;
            color: var(--primary-green);
        }
        
        .detail-content li:last-child {
            border-bottom: none;
        }
        
        .achievements {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin: 1.5rem 0;
        }
        
        .achievement-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem;
            background: var(--bg-secondary);
            border-radius: 8px;
        }
        
        .achievement-item i {
            font-size: 1.5rem;
            color: var(--primary-orange);
        }
        
        .achievement-item strong {
            display: block;
            color: var(--text-primary);
            margin-bottom: 0.25rem;
        }
        
        .achievement-item p {
            margin: 0;
            font-size: 0.9rem;
            color: var(--text-secondary);
        }
        
        .tech-architecture {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            margin: 1.5rem 0;
        }
        
        .tech-layer {
            padding: 1rem;
            background: var(--bg-secondary);
            border-radius: 8px;
            border-left: 4px solid var(--primary-blue);
        }
        
        .tech-layer strong {
            display: block;
            color: var(--text-primary);
            margin-bottom: 0.5rem;
        }
        
        .tech-layer p {
            margin: 0;
            color: var(--text-secondary);
            font-size: 0.9rem;
        }
        
        .app-features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin: 1.5rem 0;
        }
        
        .feature-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 0.5rem;
            padding: 1rem;
            background: var(--bg-secondary);
            border-radius: 8px;
        }
        
        .feature-item i {
            font-size: 1.5rem;
            color: var(--primary-purple);
        }
        
        .feature-item strong {
            color: var(--text-primary);
            font-size: 0.9rem;
        }
        
        .feature-item p {
            margin: 0;
            font-size: 0.8rem;
            color: var(--text-secondary);
        }
        
        @media (max-width: 768px) {
            .detail-header {
                flex-direction: column;
                text-align: center;
            }
            
            .project-meta-info {
                grid-template-columns: 1fr;
            }
            
            .achievements {
                grid-template-columns: 1fr;
            }
            
            .app-features {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        
        @media (max-width: 480px) {
            .app-features {
                grid-template-columns: 1fr;
            }
            
            .meta-item {
                flex-direction: column;
                text-align: center;
            }
            
            .achievement-item {
                flex-direction: column;
                text-align: center;
            }
        }
    `;
    
    document.head.appendChild(style);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initTeamPage);

// 窗口调整大小处理
window.addEventListener('resize', function() {
    // 重新计算响应式布局
    const memberCards = document.querySelectorAll('.member-card');
    memberCards.forEach(card => {
        card.style.transform = 'translateY(0) scale(1)';
    });
    
    const projectCards = document.querySelectorAll('.project-card');
    projectCards.forEach(card => {
        card.style.transform = 'translateY(0)';
    });
});

// 导出函数供全局使用
window.Team = {
    showProjectDetail,
    closeProjectModal
};