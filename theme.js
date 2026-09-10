(() => {
    const key = 'aaforms:theme';
    const system = matchMedia('(prefers-color-scheme: dark)');
    const embedded = window !== top;
    let preference = null, inherited = null, toggle, automatic;
    const valid = value => value === 'light' || value === 'dark';
    function read() {
        try { const value = localStorage.getItem(key); return valid(value) ? value : null; }
        catch { return null; }
    }
    if (embedded) document.documentElement.setAttribute('data-embedded', '');
    else preference = read();
    function send(target) {
        target.postMessage({ type: 'aaforms-theme', theme: document.documentElement.dataset.theme }, '*');
    }
    function apply() {
        const theme = inherited || preference || (system.matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
        if (toggle) {
            toggle.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
            toggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
            toggle.title = preference ? 'Manual theme selection' : 'Following OS setting';
            automatic.hidden = preference === null;
        }
        document.querySelectorAll('iframe').forEach(frame => { if (frame.contentWindow) send(frame.contentWindow); });
        window.dispatchEvent(new Event('aaforms-theme-change'));
    }
    window.addEventListener('message', event => {
        if (embedded && event.source === parent && event.data?.type === 'aaforms-theme' && valid(event.data.theme)) {
            inherited = event.data.theme;
            apply();
        } else if (event.data?.type === 'aaforms-theme-request') {
            const child = [...document.querySelectorAll('iframe')].find(frame => frame.contentWindow === event.source);
            if (child) send(child.contentWindow);
        }
    });
    system.addEventListener('change', apply);
    window.addEventListener('storage', event => {
        if (!embedded && (event.key === key || event.key === null)) { preference = read(); apply(); }
    });
    apply();
    document.addEventListener('DOMContentLoaded', () => {
        if (embedded) { parent.postMessage({ type: 'aaforms-theme-request' }, '*'); return; }
        const controls = document.createElement('div');
        controls.className = 'theme-controls';
        toggle = document.createElement('button');
        toggle.type = 'button'; toggle.id = 'theme-toggle';
        automatic = document.createElement('button');
        automatic.type = 'button'; automatic.textContent = 'Use OS setting';
        function save(value) {
            preference = value;
            try {
                if (value) localStorage.setItem(key, value);
                else localStorage.removeItem(key);
            } catch { /* The switch still works for this page when storage is blocked. */ }
            apply();
        }
        toggle.addEventListener('click', () => save(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
        automatic.addEventListener('click', () => { save(null); toggle.focus(); });
        controls.append(toggle, automatic);
        document.body.prepend(controls);
        apply();
    });
})();
