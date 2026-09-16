const menuToggle = document.querySelector('.menu-toggle');
const assignmentNav = document.querySelector('.assignment-nav');
const navLinks = document.querySelectorAll('.assignment-nav a');
const revealItems = document.querySelectorAll('.reveal');

menuToggle.addEventListener('click', () => {
  const isOpen = assignmentNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.querySelector('.menu-icon').textContent = isOpen ? '−' : '+';
});

navLinks.forEach((link) => {
  link.addEventListener('click', () => {
    assignmentNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.querySelector('.menu-icon').textContent = '+';
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.12 });

revealItems.forEach((item) => observer.observe(item));

const assignmentObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    const matchingLink = document.querySelector(`.assignment-nav a[href="#${entry.target.id}"]`);
    if (matchingLink && entry.isIntersecting) {
      navLinks.forEach((link) => link.classList.remove('active'));
      matchingLink.classList.add('active');
    }
  });
}, { rootMargin: '-20% 0px -65% 0px' });

document.querySelectorAll('.assignment-card').forEach((card) => assignmentObserver.observe(card));