//深色浅色切换
const body = document.body;
const themeBtn = document.getElementById('themeToggle');
themeBtn.addEventListener('click',()=>{
    body.classList.toggle('theme-dark');
    body.classList.toggle('theme-light');
    themeBtn.style.transform = "scale(0.92)";
    setTimeout(()=>themeBtn.style.transform="",200);
});

//图片放大弹窗
const modal = document.getElementById("imgModal");
const modalImg = document.getElementById("modalImg");
const closeBtn = document.querySelector(".close-btn");
const previewImages = document.querySelectorAll(".preview-img");

previewImages.forEach(img=>{
    img.addEventListener('click',()=>{
        modalImg.src = img.dataset.src;
        modal.classList.add("active");
        document.body.style.overflow = "hidden";
    })
})

//关闭弹窗
function closeModal(){
    modal.classList.remove("active");
    document.body.style.overflow = "";
}
closeBtn.addEventListener('click',closeModal);
modal.addEventListener('click',(e)=>{
    if(e.target === modal) closeModal();
})
//ESC按键关闭
document.addEventListener('keydown',(e)=>{
    if(e.key === 'Escape') closeModal();
})

//卡片滚动入场动画
const cards = document.querySelectorAll('.card-frame');
const observer = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
        if(entry.isIntersecting){
            entry.target.style.opacity = 1;
            entry.target.style.transform = "translateY(0)";
        }
    })
},{threshold:0.1})
cards.forEach(card=>{
    card.style.opacity = 0;
    card.style.transform = "translateY(30px)";
    card.style.transition = "all 0.6s ease";
    observer.observe(card);
})
