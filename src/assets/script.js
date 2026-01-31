document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('menuToggle');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const body = document.body;

    if (menuToggle && sidebarOverlay) {
        function toggleMenu() {
            body.classList.toggle('sidebar-open');
        }

        menuToggle.addEventListener('click', toggleMenu);
        sidebarOverlay.addEventListener('click', toggleMenu);

        // Close menu when clicking a link on mobile
        const sidebarLinks = document.querySelectorAll('.sidebar-left a');
        sidebarLinks.forEach(link => {
            link.addEventListener('click', () => {
                if (body.classList.contains('sidebar-open')) {
                    toggleMenu();
                }
            });
        });
    }

    // Toggle sidebar collapse
    document.querySelectorAll('.chevron').forEach(chevron => {
        chevron.addEventListener('click', (e) => {
            e.stopPropagation();
            const li = chevron.closest('li');
            li.classList.toggle('expanded');

            // Rotate chevron
            if (li.classList.contains('expanded')) {
                chevron.style.transform = 'rotate(90deg)';
                chevron.style.color = 'var(--un-preset-theme-colors-zinc-100)';
            } else {
                chevron.style.transform = 'rotate(0deg)';
                chevron.style.color = '';
            }
        });
    });

    // Folder labels also toggle if they don't have a direct link or if clicked on the row
    document.querySelectorAll('.folder-row').forEach(row => {
        row.addEventListener('click', (e) => {
            // Only toggle if they didn't click the actual <a> link
            if (e.target.tagName !== 'A') {
                const li = row.closest('li');
                if (li.classList.contains('has-children')) {
                    li.classList.toggle('expanded');
                }
            }
        });
    });

});
