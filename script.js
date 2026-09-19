const menuButton=document.querySelector('.menu-button');
const navLinks=document.querySelector('.nav-links');
menuButton?.addEventListener('click',()=>{const open=navLinks.classList.toggle('open');menuButton.setAttribute('aria-expanded',String(open));});
navLinks?.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{navLinks.classList.remove('open');menuButton?.setAttribute('aria-expanded','false');}));
const reveals=document.querySelectorAll('.reveal');
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}}),{threshold:.1});reveals.forEach(el=>observer.observe(el));}else{reveals.forEach(el=>el.classList.add('visible'));}

const contactForm = document.querySelector('#contact-form');
if (contactForm) {
  const fields = contactForm.querySelector('fieldset');
  const submitButton = contactForm.querySelector('button[type="submit"]');
  const status = document.querySelector('#contact-status');
  submitButton.disabled = false;

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (fields.disabled || !contactForm.reportValidity()) return;

    const values = Object.fromEntries(new FormData(contactForm));
    fields.disabled = true;
    contactForm.setAttribute('aria-busy', 'true');
    submitButton.textContent = 'Sending...';
    status.textContent = '';
    status.removeAttribute('data-state');

    try {
      const response = await fetch(contactForm.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(90000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Your message could not be sent. Please try again or email us directly.');

      contactForm.reset();
      status.dataset.state = 'success';
      status.textContent = result.message;
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error instanceof TypeError || error instanceof SyntaxError || error.name === 'TimeoutError'
        ? 'We could not confirm your message was sent. Please try again or email us directly.'
        : error.message;
    } finally {
      fields.disabled = false;
      contactForm.removeAttribute('aria-busy');
      submitButton.textContent = 'Send message';
    }
  });
}
