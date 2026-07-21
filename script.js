(function () {
    var toggle = document.getElementById('themeToggle');
    var html = document.documentElement;

    function get() {
        return localStorage.getItem('theme') ||
            (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    }

    function set(t) {
        html.setAttribute('data-theme', t);
        localStorage.setItem('theme', t);
    }

    set(get());

    if (toggle) {
        toggle.addEventListener('click', function () {
            set(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        });
    }

    var age = document.getElementById('age');

    if (age) {
        var today = new Date();
        var calculatedAge = today.getFullYear() - 2004;
        var birthdayHasPassed = today.getMonth() > 2 ||
            (today.getMonth() === 2 && today.getDate() >= 23);

        if (!birthdayHasPassed) calculatedAge -= 1;
        age.textContent = String(calculatedAge);
    }

    var errorCanvas = document.getElementById('errorCanvas');

    if (errorCanvas) {
        var errorExperiences = [
            {
                kicker: 'Market research complete',
                title: 'You found\nnothing.',
                copy: 'Still a stronger result than most market research.',
                meaning: 'Wrong turns still count as research.',
                palette: 'acid',
                layout: 'split'
            },
            {
                kicker: 'Release notes · v0.0.0',
                title: 'The MVP\nshipped first.',
                copy: 'This page is still hiding somewhere on the roadmap.',
                meaning: 'Scope small. Ship anyway.',
                palette: 'paper',
                layout: 'poster'
            },
            {
                kicker: 'Strategic realignment',
                title: 'This page\npivoted to AI.',
                copy: 'Nobody asked. The pitch deck looked incredible.',
                meaning: 'Adding AI is not a strategy.',
                palette: 'cobalt',
                layout: 'split'
            },
            {
                kicker: 'Engineering postmortem',
                title: 'Technical\ndebt won.',
                copy: 'A beautiful reminder that shortcuts also have destinations.',
                meaning: 'Shortcuts have destinations.',
                palette: 'ember',
                layout: 'terminal'
            },
            {
                kicker: 'Currently out of office',
                title: 'The founder is\nnetworking.',
                copy: 'The page said “let’s grab coffee sometime” and vanished.',
                meaning: 'Warm intros. Cold pages.',
                palette: 'violet',
                layout: 'poster'
            },
            {
                kicker: 'German infrastructure update',
                title: 'Grid connection\npending.',
                copy: 'Estimated response time: somewhere between five years and never.',
                meaning: 'Bureaucracy is latency with letterhead.',
                palette: 'signal',
                layout: 'split'
            },
            {
                kicker: 'Incident report · Friday 16:59',
                title: 'The intern\ndeployed.',
                copy: 'The good news: this is now a valuable learning experience.',
                meaning: 'Never ship Friday. Especially as the intern.',
                palette: 'ember',
                layout: 'poster'
            },
            {
                kicker: 'Investor update',
                title: 'Pre-revenue.\nPost-page.',
                copy: 'Unavailable, unprofitable, and somehow valued at €50M.',
                meaning: 'Valuation is a state of mind.',
                palette: 'acid',
                layout: 'terminal'
            },
            {
                kicker: 'Recovery protocol active',
                title: 'Gone for a\ncold plunge.',
                copy: 'Unlike the page, Jan will probably come back.',
                meaning: 'Cold water. Clear head. Missing page.',
                palette: 'cobalt',
                layout: 'poster'
            },
            {
                kicker: 'KIT priority management',
                title: 'Exam tomorrow.\nStartup today.',
                copy: 'The page is at the library pretending to understand accounting.',
                meaning: 'Deadlines create priorities. Mostly panic.',
                palette: 'paper',
                layout: 'split'
            },
            {
                kicker: 'Prototype status',
                title: 'The hardware\nworked.',
                copy: 'The website didn’t. Honestly, this is the surprising outcome.',
                meaning: 'Prototype beats pitch deck.',
                palette: 'signal',
                layout: 'terminal'
            },
            {
                kicker: 'Congratulations on the promotion',
                title: 'Your URL\nfailed upward.',
                copy: 'It is a 70-slide pitch deck now. No product, obviously.',
                meaning: 'Failing upward is still movement.',
                palette: 'violet',
                layout: 'split'
            }
        ];

        var errorTitle = document.getElementById('errorTitle');
        var errorKicker = document.getElementById('errorKicker');
        var errorCopy = document.getElementById('errorCopy');
        var errorMeaning = document.getElementById('errorMeaning');
        var errorCounter = document.getElementById('errorCounter');
        var errorShuffle = document.getElementById('errorShuffle');
        var previousError = Number(sessionStorage.getItem('jp-error-index'));
        var currentError = Math.floor(Math.random() * errorExperiences.length);

        if (errorExperiences.length > 1 && currentError === previousError) {
            currentError = (currentError + 1 + Math.floor(Math.random() * (errorExperiences.length - 1))) % errorExperiences.length;
        }

        function renderError(index) {
            var experience = errorExperiences[index];
            errorCanvas.setAttribute('data-error-palette', experience.palette);
            errorCanvas.setAttribute('data-error-layout', experience.layout);
            errorKicker.textContent = experience.kicker;
            errorTitle.innerHTML = experience.title.replace('\n', '<br>');
            errorCopy.textContent = experience.copy;
            errorMeaning.textContent = experience.meaning;
            errorCounter.textContent = 'CASE ' + String(index + 1).padStart(2, '0') + ' OF ' + errorExperiences.length;
            sessionStorage.setItem('jp-error-index', String(index));
        }

        renderError(currentError);

        errorShuffle.addEventListener('click', function () {
            currentError = (currentError + 1 + Math.floor(Math.random() * (errorExperiences.length - 1))) % errorExperiences.length;
            errorCanvas.classList.remove('is-remixing');
            void errorCanvas.offsetWidth;
            errorCanvas.classList.add('is-remixing');
            renderError(currentError);
        });

        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            errorCanvas.addEventListener('pointermove', function (event) {
                errorCanvas.style.setProperty('--error-x', ((event.clientX / window.innerWidth) - 0.5).toFixed(3));
                errorCanvas.style.setProperty('--error-y', ((event.clientY / window.innerHeight) - 0.5).toFixed(3));
            });
        }
    }

    // easter egg for the curious
    if (window.console && !window.__jpGreeted) {
        window.__jpGreeted = true;
        console.log(
            '%chey, you found the console.',
            'font-family:monospace;font-size:14px;color:#f5a524;'
        );
        console.log(
            "%cif you're reading this we should probably talk → hello@janpfrenger.com",
            'font-family:monospace;font-size:12px;'
        );
    }
})();
