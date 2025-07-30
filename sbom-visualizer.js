class SBOMVisualizer {
    constructor() {
        // List of SBOM file names to load
        this.sbomFileNames = [
            'examples/Stage1.json',
            'examples/Stage1v2.json',
            'examples/Stage2.json',
            'examples/Stage2v2.json',
            'examples/Stage3.json'
        ];
        
        // Will be populated as files are loaded
        this.sbomData = [];
        
        this.currentStage = -1;
        this.uploadedSboms = [];
        this.dependencyGraph = new Map();
        this.nodePositions = new Map();
        this.graphElements = [];

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadSbomData()
            .then(() => {
                this.updateStageIndicator();
                this.updateDisplay();
            })
            .catch(error => {
                console.error('Error loading SBOM data:', error);
            });
    }
    
    async loadSbomData() {
        try {
            // Clear existing data
            this.sbomData = [];
            
            // Load each file
            for (const fileName of this.sbomFileNames) {
                const response = await fetch(fileName);
                if (!response.ok) {
                    throw new Error(`Failed to load ${fileName}: ${response.statusText}`);
                }
                const data = await response.json();
                this.sbomData.push(data);
            }
            
            console.log(`Loaded ${this.sbomData.length} SBOM files`);
        } catch (error) {
            console.error('Error loading SBOM files:', error);
            throw error;
        }
    }

    setupEventListeners() {
        const nextButton = document.getElementById('nextButton');
        nextButton.addEventListener('click', () => this.nextStage());

        const uploadedList = document.getElementById('uploadedList');
        uploadedList.addEventListener('click', (e) => {
            const item = e.target.closest('.uploaded-item');
            if (item) {
                const index = parseInt(item.dataset.index);
                this.showSbomDetails(index);
            }
        });
    }

    nextStage() {
        // Check if data is loaded and there are more stages
        if (this.sbomData.length > 0 && this.currentStage < this.sbomData.length - 1) {
            this.currentStage++;
            const sbom = this.sbomData[this.currentStage];
            this.uploadedSboms.push(sbom);
            this.updateDependencyGraph(sbom);
            this.updateDisplay();
            this.animateGraphUpdate();
            this.updateStageIndicator();
            this.updateProgress();
        } else if (this.sbomData.length === 0) {
            console.warn('Cannot proceed to next stage: SBOM data not loaded yet');
        }
    }

    updateDependencyGraph(sbom) {
        // Add dependencies from the new SBOM
        sbom.dependencies.forEach(dep => {
            if (!this.dependencyGraph.has(dep.ref)) {
                this.dependencyGraph.set(dep.ref, []);
            }
            dep.dependsOn.forEach(dependency => {
                if (!this.dependencyGraph.get(dep.ref).includes(dependency)) {
                    this.dependencyGraph.get(dep.ref).push(dependency);
                }
            });
        });
    }

    updateDisplay() {
        this.updateCurrentSbom();
        this.updateNextSbom();
        this.updateUploadedList();
        this.renderGraph();
    }

    updateCurrentSbom() {
        const currentSbom = document.getElementById('currentSbom');
        
        // If no data is loaded yet
        if (this.sbomData.length === 0) {
            currentSbom.innerHTML = `
                <div class="sbom-title">Loading SBOM data...</div>
                <div class="sbom-metadata">Please wait</div>
                <div class="component-list"></div>
            `;
            return;
        }
        
        if (this.currentStage >= 0) {
            const sbom = this.sbomData[this.currentStage];
            const components = sbom.components.map(c => c.purl);
            
            const dependencyVisualization = sbom.dependencies
                .map(dep => `
                    <div class="dependency-item">
                        <span class="component-tag">${dep.ref}</span>
                        <span class="dependency-arrow">→</span>
                        <div class="dependency-list">
                            ${dep.dependsOn.map(d => `<span class="dependency-tag">${d}</span>`).join('')}
                        </div>
                    </div>
                `).join('');

            currentSbom.innerHTML = `
                <div class="sbom-title">${sbom.metadata.component.purl}</div>
                <div class="sbom-metadata">${sbom.bomFormat} v${sbom.specVersion}</div>
                <div class="component-list">
                    ${dependencyVisualization ? `<div class="dependency-visualization">${dependencyVisualization}</div>` : ''}
                </div>
            `;
        } else {
            currentSbom.innerHTML = `
                <div class="sbom-title">No SBOM uploaded yet</div>
                <div class="sbom-metadata">Click "Start Upload Process" to begin</div>
                <div class="component-list"></div>
            `;
        }
    }

    updateNextSbom() {
        const nextSbom = document.getElementById('nextSbom');
        const nextButton = document.getElementById('nextButton');
        
        // If no data is loaded yet
        if (this.sbomData.length === 0) {
            nextSbom.innerHTML = `
                <div class="sbom-title">Loading SBOM data...</div>
                <div class="sbom-metadata">Please wait</div>
                <div class="component-list"></div>
            `;
            
            nextButton.textContent = 'Loading...';
            nextButton.disabled = true;
            return;
        }
        
        if (this.currentStage < this.sbomData.length - 1) {
            const sbom = this.sbomData[this.currentStage + 1];
            const components = sbom.components.map(c => c.purl);
            
            const dependencyVisualization = sbom.dependencies
                .map(dep => `
                    <div class="dependency-item">
                        <span class="component-tag">${dep.ref}</span>
                        <span class="dependency-arrow">→</span>
                        <div class="dependency-list">
                            ${dep.dependsOn.map(d => `<span class="dependency-tag">${d}</span>`).join('')}
                        </div>
                    </div>
                `).join('');

            nextSbom.innerHTML = `
                <div class="sbom-title">${sbom.metadata.component.purl}</div>
                <div class="sbom-metadata">${sbom.bomFormat} v${sbom.specVersion}</div>
                <div class="component-list">
                    ${dependencyVisualization ? `<div class="dependency-visualization">${dependencyVisualization}</div>` : ''}
                </div>
            `;
            
            nextButton.textContent = this.currentStage === -1 ? 'Start Upload Process' : 'Upload Next SBOM';
            nextButton.disabled = false;
        } else {
            nextSbom.innerHTML = `
                <div class="sbom-title">All SBOMs uploaded</div>
                <div class="sbom-metadata">Upload process complete</div>
                <div class="component-list"></div>
            `;
            
            nextButton.textContent = 'Upload Complete';
            nextButton.disabled = true;
        }
    }

    updateUploadedList() {
        const uploadedList = document.getElementById('uploadedList');
        
        uploadedList.innerHTML = this.uploadedSboms.map((sbom, index) => {
            const components = sbom.components.map(c => c.purl);
            const dependencyVisualization = sbom.dependencies
                .map(dep => `
                    <div class="dependency-item">
                        <span class="component-tag" style="font-size: 10px; padding: 1px 4px;">${dep.ref}</span>
                        <span class="dependency-arrow" style="font-size: 10px;">→</span>
                        <div class="dependency-list">
                            ${dep.dependsOn.map(d => `<span class="dependency-tag" style="font-size: 9px; padding: 1px 3px;">${d}</span>`).join('')}
                        </div>
                    </div>
                `).join('');
            
            return `
                <div class="uploaded-item" data-index="${index}">
                    <div style="font-weight: 600; margin-bottom: 5px;">
                        Stage ${index + 1}: ${sbom.metadata.component.purl}
                    </div>
                    <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
                        ${sbom.components.length} components, ${sbom.dependencies.length} dependencies
                    </div>
                    <div style="font-size: 10px;">
                    </div>
                    ${dependencyVisualization ? `<div class="dependency-visualization" style="margin-top: 5px; padding: 5px; font-size: 9px;">${dependencyVisualization}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    updateStageIndicator() {
        const stageIndicator = document.getElementById('stageIndicator');
        
        if (this.sbomData.length === 0) {
            // If no data is loaded yet, show loading indicator
            stageIndicator.innerHTML = '<div class="loading">Loading SBOM data...</div>';
            return;
        }
        
        stageIndicator.innerHTML = this.sbomData.map((_, index) => {
            let className = 'stage-dot';
            if (index < this.currentStage) className += ' completed';
            else if (index === this.currentStage) className += ' active';
            return `<div class="${className}"></div>`;
        }).join('');
    }

    updateProgress() {
        const progressFill = document.getElementById('progressFill');
        
        if (this.sbomData.length === 0) {
            // If no data is loaded yet, show indeterminate progress
            progressFill.style.width = '5%';
            progressFill.classList.add('loading');
            return;
        } else {
            progressFill.classList.remove('loading');
        }
        
        const progress = ((this.currentStage + 1) / this.sbomData.length) * 100;
        progressFill.style.width = `${progress}%`;
    }

    renderGraph() {
        const container = document.getElementById('graphContainer');
        
        // Clear existing graph
        this.graphElements.forEach(el => el.remove());
        this.graphElements = [];
        
        if (this.dependencyGraph.size === 0) return;
        
        // Calculate node positions
        this.calculateNodePositions();
        
        // Render edges first (so they appear behind nodes)
        this.renderEdges(container);
        
        // Render nodes
        this.renderNodes(container);
    }

    calculateNodePositions() {
        const container = document.getElementById('graphContainer');
        const containerRect = container.getBoundingClientRect();
        const width = containerRect.width - 100;
        const height = containerRect.height - 100;
        
        const allNodes = new Set();
        this.dependencyGraph.forEach((deps, node) => {
            allNodes.add(node);
            deps.forEach(dep => allNodes.add(dep));
        });
        
        const levels = this.calculateNodeLevels();
        const nodesByLevel = new Map();
        
        levels.forEach((level, node) => {
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level).push(node);
        });
        
        const maxLevel = Math.max(...levels.values());
        const levelHeight = height / (maxLevel + 1);
        
        nodesByLevel.forEach((nodes, level) => {
            const y = 50 + level * levelHeight;
            const spacing = width / (nodes.length + 1);
            
            nodes.forEach((node, index) => {
                const x = 50 + (index + 1) * spacing;
                this.nodePositions.set(node, { x, y });
            });
        });
    }

    calculateNodeLevels() {
        const levels = new Map();
        const visited = new Set();
        
        const hasIncoming = new Set();
        this.dependencyGraph.forEach(deps => {
            deps.forEach(dep => hasIncoming.add(dep));
        });
        
        const roots = [];
        this.dependencyGraph.forEach((_, node) => {
            if (!hasIncoming.has(node)) {
                roots.push(node);
            }
        });
        
        const queue = roots.map(root => ({ node: root, level: 0 }));
        
        while (queue.length > 0) {
            const { node, level } = queue.shift();
            
            if (visited.has(node)) continue;
            visited.add(node);
            levels.set(node, level);
            
            const dependencies = this.dependencyGraph.get(node) || [];
            dependencies.forEach(dep => {
                if (!visited.has(dep)) {
                    queue.push({ node: dep, level: level + 1 });
                }
            });
        }
        
        this.dependencyGraph.forEach((_, node) => {
            if (!levels.has(node)) {
                levels.set(node, 0);
            }
        });
        
        return levels;
    }

    renderNodes(container) {
        this.nodePositions.forEach((pos, node) => {
            const nodeEl = document.createElement('div');
            nodeEl.className = 'node';
            nodeEl.textContent = node;
            nodeEl.style.left = `${pos.x}px`;
            nodeEl.style.top = `${pos.y}px`;
            nodeEl.style.transform = 'translate(-50%, -50%)';
            
            const hasOutgoing = this.dependencyGraph.has(node);
            const hasIncoming = Array.from(this.dependencyGraph.values()).some(deps => deps.includes(node));
            
            if (hasOutgoing && !hasIncoming) {
                nodeEl.classList.add('root');
            } else if (!hasOutgoing && hasIncoming) {
                nodeEl.classList.add('leaf');
            }
            
            nodeEl.addEventListener('mouseenter', (e) => this.showTooltip(e, node));
            nodeEl.addEventListener('mouseleave', () => this.hideTooltip());
            
            container.appendChild(nodeEl);
            this.graphElements.push(nodeEl);
        });
    }

    renderEdges(container) {
        this.dependencyGraph.forEach((deps, node) => {
            const nodePos = this.nodePositions.get(node);
            if (!nodePos) return;
            
            deps.forEach(dep => {
                const depPos = this.nodePositions.get(dep);
                if (!depPos) return;
                
                const edge = this.createEdge(nodePos, depPos);
                container.appendChild(edge);
                this.graphElements.push(edge);
            });
        });
    }

    createEdge(from, to) {
        const edge = document.createElement('div');
        edge.className = 'edge';
        
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        
        edge.style.left = `${from.x}px`;
        edge.style.top = `${from.y}px`;
        edge.style.width = `${length}px`;
        edge.style.transform = `rotate(${angle}deg)`;
        
        return edge;
    }

    animateGraphUpdate() {
        // Check if data is loaded and we have a valid current stage
        if (this.sbomData.length === 0 || this.currentStage < 0 || this.currentStage >= this.sbomData.length) {
            return;
        }
        
        // Get nodes that were just added in this stage
        const currentSbom = this.sbomData[this.currentStage];
        
        // Track which nodes existed before this stage
        const previousNodes = new Set();
        for (let i = 0; i < this.currentStage; i++) {
            const prevSbom = this.sbomData[i];
            previousNodes.add(prevSbom.metadata.component.purl);
            prevSbom.components.forEach(c => previousNodes.add(c.purl));
        }
        
        // Only get truly new nodes (not in previous stages)
        const newNodeNames = [currentSbom.metadata.component.purl, ...currentSbom.components.map(c => c.purl)]
            .filter(name => !previousNodes.has(name));
        
        const nodes = document.querySelectorAll('.node');
        const newNodes = Array.from(nodes).filter(node => newNodeNames.includes(node.textContent));

        // Set initial state and animate only new nodes
        if (newNodes.length > 0) {
            // Set initial invisible state
            newNodes.forEach(node => {
                node.style.transform += ' scale(0)';
                node.style.opacity = '0';
            });
            
            // Animate in
            anime({
                targets: newNodes,
                scale: [0, 1],
                opacity: [0, 1],
                duration: 800,
                delay: anime.stagger(200),
                easing: 'easeInOutElastic(1, .8)'
            });
        }
        
        // Animate only the new edges
        const edges = document.querySelectorAll('.edge');
        const newEdges = Array.from(edges).slice(-currentSbom.dependencies.length);
        
        if (newEdges.length > 0) {
            anime({
                targets: newEdges,
                scaleX: [0, 1],
                opacity: [0, 0.8],
                duration: 600,
                delay: 400,
                easing: 'easeOutQuad'
            });
        }
    }

    showTooltip(event, node) {
        const tooltip = document.getElementById('tooltip');
        const deps = this.dependencyGraph.get(node) || [];
        
        tooltip.innerHTML = `
            <strong>${node}</strong><br>
            ${deps.length > 0 ? `Dependencies: ${deps.join(', ')}` : 'No dependencies'}
        `;
        
        tooltip.style.left = `${event.pageX + 10}px`;
        tooltip.style.top = `${event.pageY - 10}px`;
        tooltip.style.opacity = '1';
    }

    hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        tooltip.style.opacity = '0';
    }

    showSbomDetails(index) {
        // Clear previous highlights
        document.querySelectorAll('.uploaded-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelectorAll('.node').forEach(node => {
            node.classList.remove('highlighted');
        });
        
        const clickedItem = document.querySelector(`[data-index="${index}"]`);
        clickedItem.classList.add('active');
        
        const sbom = this.uploadedSboms[index];
        const relevantNodes = [
            sbom.metadata.component.purl, 
            ...sbom.components.map(c => c.purl)
        ];

        // Highlight relevant nodes with CSS class and animation
        document.querySelectorAll('.node').forEach(node => {
            if (relevantNodes.includes(node.textContent)) {
                node.classList.add('highlighted');
                anime({
                    targets: node,
                    scale: [1, 1.4, 1.15],
                    duration: 1000,
                    easing: 'easeOutElastic(1, .8)'
                });
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SBOMVisualizer();
});

