        const cardContainer = document.getElementById('cardContainer');
        const backdrop = document.getElementById('backdrop');
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsDropdown = document.getElementById('settingsDropdown');
        const qualityRadios = document.querySelectorAll('input[name="quality"]');

        // Settings - Quality
        const currentQuality = localStorage.getItem('quality') || 'normal';
        if (currentQuality === 'low') {
            document.body.classList.add('low-quality');
            document.querySelector('input[value="low"]').checked = true;
        }

        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsDropdown.classList.toggle('open');
            settingsBtn.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!settingsDropdown.contains(e.target) && e.target !== settingsBtn) {
                settingsDropdown.classList.remove('open');
                settingsBtn.classList.remove('active');
            }
        });

        qualityRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                const quality = document.querySelector('input[name="quality"]:checked').value;
                localStorage.setItem('quality', quality);
                if (quality === 'low') {
                    document.body.classList.add('low-quality');
                } else {
                    document.body.classList.remove('low-quality');
                }
            });
        });

        let tools = [];
        let morphCard = null;
        let selectedTool = null;
        let selectedCard = null;

        // Load tools
        fetch('tools-config.json')
            .then(response => response.json())
            .then(data => {
                tools = data.tools || [];
                tools.sort((a, b) => {
                    if (a.featured !== b.featured) return b.featured ? 1 : -1;
                    return a.name.localeCompare(b.name);
                });
                renderCards(tools);
            })
            .catch(error => {
                cardContainer.innerHTML = '<p class="no-results">加载工具失败</p>';
            });

        const subjectNames = {
            '数学': '数学', '物理': '物理', '化学': '化学', '生物': '生物',
            '语文': '语文', '英语': '英语', '地理': '地理', '历史': '历史',
            '道法': '道法', '通用': '通用工具'
        };

        function renderCards(toolsToRender) {
            cardContainer.innerHTML = '';
            if (toolsToRender.length === 0) {
                cardContainer.innerHTML = '<p class="no-results">没有找到匹配的工具</p>';
                return;
            }

            const grouped = {};
            toolsToRender.forEach(tool => {
                const subject = (tool.subject && tool.subject[0]) || '通用';
                if (!grouped[subject]) grouped[subject] = [];
                grouped[subject].push(tool);
            });

            Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length).forEach(subject => {
                const section = document.createElement('div');
                section.className = 'category-section';
                section.innerHTML = `<div class="category-title">${subjectNames[subject] || subject}</div>`;
                cardContainer.appendChild(section);

                grouped[subject].forEach(tool => {
                    const card = document.createElement('div');
                    card.className = 'card';
                    card.dataset.tool = tool.name;
                    card.innerHTML = `
                        <div class="card-header">
                            <span class="card-icon">${tool.icon || '📄'}</span>
                            <span class="card-name">${tool.name}</span>
                        </div>
                        <div class="card-tags">
                            ${tool.tags ? tool.tags.slice(0, 3).map(t => `<span class="card-tag">${t}</span>`).join('') : ''}
                        </div>
                    `;
                    card.addEventListener('click', () => selectCard(card, tool));
                    cardContainer.appendChild(card);
                });
            });
        }

        function selectCard(cardElement, tool) {
            if (morphCard) return;
            selectedTool = tool;
            selectedCard = cardElement;

            const rect = cardElement.getBoundingClientRect();

            // Create morph card at card's position
            morphCard = document.createElement('div');
            morphCard.className = 'morph-card compact';
            morphCard.innerHTML = `
                <div class="morph-header">
                    <span class="morph-icon">${tool.icon || '📄'}</span>
                    <span class="morph-name">${tool.name}</span>
                </div>
                <div class="morph-tags">
                    ${tool.tags ? tool.tags.slice(0, 3).map(t => `<span class="morph-tag">${t}</span>`).join('') : ''}
                </div>
                <div class="morph-content">
                    <div class="morph-big-icon">${tool.icon || '📄'}</div>
                    <h2>${tool.name}</h2>
                    <p>${tool.description}</p>
                    <a href="${tool.name}/index.html" class="btn-explore">Explore</a>
                </div>
                <button class="close-btn">&times;</button>
            `;

            morphCard.style.left = rect.left + 'px';
            morphCard.style.top = rect.top + 'px';
            morphCard.style.width = rect.width + 'px';
            morphCard.style.minHeight = rect.height + 'px';
            document.body.appendChild(morphCard);

            // Hide original card
            cardElement.style.visibility = 'hidden';

            // Show backdrop
            backdrop.classList.add('active');

            // Calculate target position
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const targetWidth = Math.min(450, viewportWidth * 0.9);
            const targetHeight = 340;
            const targetLeft = (viewportWidth - targetWidth) / 2;
            const targetTop = (viewportHeight - targetHeight) / 2;

            // Animate to center
            requestAnimationFrame(() => {
                morphCard.style.transition = 'all 750ms cubic-bezier(0.34, 1.4, 0.64, 1)';
                morphCard.style.left = targetLeft + 'px';
                morphCard.style.top = targetTop + 'px';
                morphCard.style.width = targetWidth + 'px';
                morphCard.style.minHeight = targetHeight + 'px';
            });

            // Other cards hide
            const allCards = Array.from(cardContainer.querySelectorAll('.card'));
            allCards.forEach(card => {
                if (card === cardElement) return;
                const cardRect = card.getBoundingClientRect();
                const delay = Math.max(0, ((viewportHeight - cardRect.top) / viewportHeight) * 120);
                card.style.animationDelay = `${delay}ms`;
                card.classList.add('hiding');
            });

            // Expand to show content
            setTimeout(() => {
                morphCard.classList.add('expanded');
            }, 200);

            // Close handlers
            morphCard.querySelector('.close-btn').addEventListener('click', closeMorphCard);
            backdrop.addEventListener('click', closeMorphCard);
        }

        function closeMorphCard() {
            if (!morphCard || !selectedCard) return;

            const originalRect = selectedCard.getBoundingClientRect();

            // Get all hiding cards
            const hidingCards = Array.from(cardContainer.querySelectorAll('.card.hiding'));

            // Start fading backdrop immediately
            backdrop.style.opacity = '0';

            // Shrink morphCard back to original position
            morphCard.classList.remove('expanded');
            morphCard.style.transition = 'all 750ms cubic-bezier(0.34, 1.4, 0.64, 1)';
            morphCard.style.left = originalRect.left + 'px';
            morphCard.style.top = originalRect.top + 'px';
            morphCard.style.width = originalRect.width + 'px';
            morphCard.style.minHeight = originalRect.height + 'px';

            // Start returning all cards (from bottom to top)
            requestAnimationFrame(() => {
                hidingCards.reverse().forEach((card, i) => {
                    card.classList.remove('hiding');
                    card.style.transform = 'translateY(-100vh)';
                    card.style.opacity = '0';
                    card.getBoundingClientRect();
                    setTimeout(() => {
                        card.classList.add('returning');
                    }, i * 40);
                });
            });

            setTimeout(() => {
                if (morphCard) {
                    morphCard.remove();
                    morphCard = null;
                }
                backdrop.classList.remove('active');
                backdrop.style.opacity = '';

                if (selectedCard) {
                    selectedCard.style.visibility = 'visible';
                }

                // Clean up after animation
                setTimeout(() => {
                    hidingCards.forEach(card => {
                        card.classList.remove('returning');
                        card.style.transform = '';
                        card.style.opacity = '';
                    });
                }, 800);

                selectedCard = null;
                selectedTool = null;
            }, 800);
        }

        // Keyboard escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && morphCard) closeMorphCard();
        });

        // Search
        searchInput.addEventListener('focus', () => {
            document.querySelector('.search-box').classList.add('searching');
        });

        searchInput.addEventListener('blur', () => {
            document.querySelector('.search-box').classList.remove('searching');
        });

        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            if (term) {
                renderCards(tools.filter(t =>
                    t.name.toLowerCase().includes(term) ||
                    (t.tags && t.tags.some(tag => tag.toLowerCase().includes(term))) ||
                    (t.subject && t.subject.some(s => s.toLowerCase().includes(term))) ||
                    t.description.toLowerCase().includes(term)
                ));
            } else {
                renderCards(tools);
            }
        });
