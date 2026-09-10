(() => {
    const prefix = 'aaforms:completed:';
    const caseId = location.pathname.split('/').pop();
    const control = caseId === 'case-closed.html' && new URLSearchParams(location.search).get('root') === 'open';
    let indicator;
    if (!document.querySelector('.catalog')) {
        indicator = document.createElement('p');
        indicator.id = 'case-completion';
        indicator.setAttribute('role', 'status');
        indicator.style.cssText = 'padding:12px 16px;border:1px solid var(--theme-line, #b6d2e6);border-radius:4px;font-weight:600;';
        const target = document.querySelector('#result, #person-form') || document.querySelector('.back');
        if (target) target.before(indicator);
        else document.querySelector('.container').append(indicator);
    }
    function showCurrent(complete) {
        if (!indicator) return;
        indicator.textContent = complete ? 'Completed' : 'Not completed';
        indicator.style.color = complete ? 'var(--theme-success, #176538)' : 'var(--theme-muted, #3a4350)';
        indicator.style.background = complete ? 'var(--theme-success-surface, #eaf6ed)' : 'var(--theme-page, #f3f3f3)';
    }
    function unavailable() {
        let notice = document.getElementById('progress-storage-note');
        if (!notice) {
            notice = document.createElement('p');
            notice.id = 'progress-storage-note';
            notice.setAttribute('role', 'status');
            (document.querySelector('.container') || document.body).append(notice);
        }
        notice.textContent = 'Browser storage is unavailable. Completion progress cannot be saved.';
    }
    window.AAProgress = {
        showCurrent,
        isComplete(id) {
            try { return localStorage.getItem(prefix + id) === '1'; }
            catch { unavailable(); return false; }
        },
        set(id, complete) {
            try {
                if (complete === true) localStorage.setItem(prefix + id, '1');
                else localStorage.removeItem(prefix + id);
                window.dispatchEvent(new Event('aaforms-progress'));
            } catch { unavailable(); }
        }
    };
    function renderCurrent() {
        if (indicator && !control) showCurrent(AAProgress.isComplete(caseId));
    }
    showCurrent(false);
    window.addEventListener('aaforms-progress', renderCurrent);
    window.addEventListener('storage', renderCurrent);
    window.addEventListener('pageshow', renderCurrent);
    renderCurrent();
})();
