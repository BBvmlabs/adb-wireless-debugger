document.addEventListener('DOMContentLoaded', () => {
    /* ==========================================================================
       Mobile Navigation Toggle
       ========================================================================== */
    const mobileToggle = document.getElementById('mobile-toggle');
    const navMobile = document.getElementById('nav-mobile');
    const header = document.getElementById('header');

    if (mobileToggle && navMobile) {
        mobileToggle.addEventListener('click', () => {
            const isActive = mobileToggle.classList.toggle('is-active');
            navMobile.classList.toggle('is-active');
            
            // Prevent body scrolling when menu is open
            if (isActive) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
        });

        // Close mobile menu when clicking a link
        const mobileLinks = navMobile.querySelectorAll('.nav__link--mobile, .btn');
        mobileLinks.forEach(link => {
            link.addEventListener('click', () => {
                mobileToggle.classList.remove('is-active');
                navMobile.classList.remove('is-active');
                document.body.style.overflow = '';
            });
        });
    }

    /* ==========================================================================
       Header Scroll Effect
       ========================================================================== */
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.style.background = 'rgba(9, 12, 21, 0.95)';
            header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.5)';
        } else {
            header.style.background = 'rgba(9, 12, 21, 0.8)';
            header.style.boxShadow = 'none';
        }
    });

    /* ==========================================================================
       Scroll Reveal Animations
       ========================================================================== */
    const revealElements = document.querySelectorAll('.reveal');

    const revealCallback = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Add is-visible to trigger CSS animations
                entry.target.classList.add('is-visible');
                // Stop observing once revealed
                observer.unobserve(entry.target);
            }
        });
    };

    const revealOptions = {
        root: null,
        rootMargin: '0px 0px -50px 0px',
        threshold: 0.1
    };

    const revealObserver = new IntersectionObserver(revealCallback, revealOptions);

    revealElements.forEach(element => {
        revealObserver.observe(element);
    });
});
