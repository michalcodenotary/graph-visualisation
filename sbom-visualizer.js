/**
 * SBOM Visualizer
 * 
 * This class visualizes Software Bill of Materials (SBOM) data and their dependencies.
 * 
 * Features:
 * - Loads and displays SBOM data from JSON files
 * - Visualizes dependencies between components in a graph
 * - Supports step-by-step uploading of SBOMs to show the evolution of the dependency graph
 * - Supports "Custom Upload" with a popup interface for selecting from available SBOMs or uploading your own
 * - Implements validation to prevent modifying existing dependencies without Force Mode
 * - Supports "Force Mode" for intelligent merging of SBOM data
 * - Supports "History Navigation" to view the dependency graph at different points in time
 * 
 * Custom Upload:
 * The "Upload Custom" button opens a popup that allows users to:
 * - Select from a list of available SBOM files
 * - Upload their own SBOM file
 * - Enable or disable Force Mode for the upload
 * 
 * Validation Logic:
 * When Force Mode is disabled, the system validates that the SBOM being uploaded doesn't modify existing dependencies:
 * - If the SBOM would modify existing dependencies, an error message is shown
 * - If the SBOM only adds new dependencies or nodes, it's allowed to proceed
 * 
 * Force Mode:
 * When enabled, Force Mode intelligently merges and overwrites existing nodes in the dependency graph.
 * - For nodes explicitly mentioned in the force import file, their dependencies are replaced with the new ones
 * - For nodes that are referenced but don't have dependencies specified, their existing dependencies remain unchanged
 * - Nodes not mentioned in the force import file are left untouched
 * 
 * History Navigation:
 * The history navigation feature allows users to:
 * - Navigate backward and forward through the history of uploaded SBOMs
 * - View the dependency graph at different points in time
 * - See how the graph evolved as SBOMs were added
 * 
 * Example:
 * If node "aaa" has dependencies ["bbb", "ccc", "ddd"] and a force import specifies "aaa" with dependencies ["bbb", "cccV2"],
 * the result will be "aaa" with dependencies ["bbb", "cccV2"] (replacing "ccc" and removing "ddd").
 */
class SBOMVisualizer {
    constructor() {
        // List of SBOM file names to load for the main sequence
        this.sbomFileNames = [
            'examples/Stage1.json',
            'examples/Stage1v2.json',
            'examples/Stage2.json',
            'examples/Stage2v2.json',
            'examples/Stage3.json',
        ];
        
        // All available SBOM files for custom upload
        this.availableSbomFiles = [
            // { name: 'Stage2NotAllowed.json.json', path: 'examples/Stage2NotAllowed.json.json', forceMode: false },
            { name: 'ForceMini.json', path: 'examples/ForceMini.json', forceMode: true },
            { name: 'Force.json', path: 'examples/Force.json', forceMode: true },
            { name: 'Stage2NotAllowed.json', path: 'examples/Stage2NotAllowed.json', forceMode: false }
        ];
        
        // Will be populated as files are loaded
        this.sbomData = [];
        
        this.currentStage = -1;
        this.uploadedSboms = [];
        this.dependencyGraph = new Map();
        this.nodePositions = new Map();
        this.graphElements = [];
        
        // Track selected SBOM in popup
        this.selectedSbomFile = null;
        this.customFileUpload = null;
        
        // History navigation properties
        this.historyPosition = -1;  // Current position in history (-1 means no history yet)
        this.historyStates = [];    // Array of dependency graph states at each point in history
        this.viewingHistory = false; // Flag to indicate if we're viewing history
        
        // Track highlighted SBOMs
        this.highlightedSboms = new Set();

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadSbomData()
            .then(() => {
                this.updateStageIndicator();
                this.updateDisplay();
                
                // Initialize history with the empty state
                this.saveHistoryState();
                this.updateHistoryIndicator();
                this.updateHistoryNavigationButtons();
            })
            .catch(error => {
                console.error('Error loading SBOM data:', error);
            });
    }
    
    async loadSbomData() {
        try {
            // Clear existing data
            this.sbomData = [];
            
            // Load all files from the consolidated list
            for (const fileName of this.sbomFileNames) {
                const response = await fetch(fileName);
                if (!response.ok) {
                    throw new Error(`Failed to load ${fileName}: ${response.statusText}`);
                }
                const data = await response.json();
                
                // Determine if this is a force mode file based on the file path
                // This preserves the original behavior where ForceMini.json was a force mode file
                const isForceMode = fileName.includes('Force');
                data.forceMode = isForceMode;
                
                this.sbomData.push(data);
            }
            
            // Count force mode files for logging
            const forceModeCount = this.sbomData.filter(data => data.forceMode).length;
            console.log(`Loaded ${this.sbomData.length} SBOM files (including ${forceModeCount} force mode files)`);
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
        
        // Setup Upload Custom button and popup
        this.setupCustomUploadUI();
        
        // Setup history navigation buttons
        this.setupHistoryNavigation();
    }
    
    setupHistoryNavigation() {
        const prevHistoryButton = document.getElementById('prevHistoryButton');
        const nextHistoryButton = document.getElementById('nextHistoryButton');
        
        if (prevHistoryButton) {
            prevHistoryButton.addEventListener('click', () => this.navigateHistoryBackward());
            // Initially disabled until we have history
            prevHistoryButton.disabled = true;
        }
        
        if (nextHistoryButton) {
            nextHistoryButton.addEventListener('click', () => this.navigateHistoryForward());
            // Initially disabled until we have history and are viewing past state
            nextHistoryButton.disabled = true;
        }
    }
    
    navigateHistoryBackward() {
        if (this.historyPosition <= 0) {
            return; // Can't go back further
        }
        
        this.historyPosition--;
        this.viewingHistory = true;
        this.updateHistoryView();
    }
    
    navigateHistoryForward() {
        if (this.historyPosition >= this.historyStates.length - 1) {
            return; // Can't go forward further
        }
        
        this.historyPosition++;
        
        // If we've reached the current state, we're no longer viewing history
        if (this.historyPosition === this.historyStates.length - 1) {
            this.viewingHistory = false;
        }
        
        this.updateHistoryView();
    }
    
    updateHistoryView() {
        if (this.historyPosition < 0 || this.historyPosition >= this.historyStates.length) {
            return; // Invalid history position
        }
        
        // Get the historical state
        const historicalState = this.historyStates[this.historyPosition];
        
        // Temporarily replace the current dependency graph with the historical one
        const currentGraph = this.dependencyGraph;
        this.dependencyGraph = new Map(historicalState.dependencyGraph);
        
        // BUGFIX: Clear the nodePositions map to ensure only nodes from the historical state are rendered
        // This fixes the issue where nodes from later SBOMs were still visible when navigating back in history
        // Without this, the nodePositions map would retain positions for all nodes ever added, causing them to be rendered
        // even if they weren't part of the dependency graph at this point in history
        this.nodePositions = new Map();
        
        // Log information about the historical state for debugging
        console.log(`Viewing historical state ${this.historyPosition + 1}/${this.historyStates.length}`);
        console.log(`Historical state has ${historicalState.dependencyGraph.size} nodes in the dependency graph`);
        console.log('Nodes in historical dependency graph:', Array.from(historicalState.dependencyGraph.keys()));
        
        // Update the visualization
        this.renderGraph();
        
        // Update the history indicator
        this.updateHistoryIndicator();
        
        // Update navigation buttons
        this.updateHistoryNavigationButtons();
        
        // Add visual indication that we're viewing history
        const graphContainer = document.getElementById('graphContainer');
        if (graphContainer) {
            if (this.viewingHistory) {
                graphContainer.classList.add('viewing-history');
            } else {
                graphContainer.classList.remove('viewing-history');
            }
        }
        
        // Update stage indicator and progress bar to reflect historical state
        if (this.viewingHistory) {
            // Calculate the approximate stage based on the number of SBOMs in this historical state
            const historicalSbomCount = historicalState.sbomCount || 0;
            const approximateStage = historicalSbomCount > 0 ? historicalSbomCount - 1 : -1;
            
            // Update stage indicator
            const stageIndicator = document.getElementById('stageIndicator');
            if (stageIndicator) {
                stageIndicator.innerHTML = this.sbomData.map((_, index) => {
                    let className = 'stage-dot';
                    if (index < approximateStage) className += ' completed';
                    if (index === approximateStage) className += ' active';
                    return `<div class="${className}"></div>`;
                }).join('');
            }
            
            // Update progress bar
            const progressFill = document.getElementById('progressFill');
            if (progressFill) {
                const progress = ((approximateStage + 1) / this.sbomData.length) * 100;
                progressFill.style.width = `${progress}%`;
                progressFill.classList.add('historical');
            }
        } else {
            // If we're back to current state, update normally
            this.updateStageIndicator();
            this.updateProgress();
            
            // Remove historical class from progress bar
            const progressFill = document.getElementById('progressFill');
            if (progressFill) {
                progressFill.classList.remove('historical');
            }
        }
        
        // Restore the current dependency graph if we're viewing history
        if (this.viewingHistory) {
            // Keep the historical view for display, but store the current state
            this._currentGraph = currentGraph;
        } else {
            // We're back to the current state, no need to store separately
            this._currentGraph = null;
        }
    }
    
    updateHistoryIndicator() {
        const historyIndicator = document.getElementById('historyIndicator');
        if (!historyIndicator) return;
        
        if (this.historyPosition < 0 || this.historyStates.length === 0) {
            historyIndicator.textContent = 'No History';
            return;
        }
        
        const state = this.historyStates[this.historyPosition];
        const totalStates = this.historyStates.length;
        
        if (this.viewingHistory) {
            historyIndicator.textContent = `Historical View (${this.historyPosition + 1}/${totalStates})`;
            historyIndicator.classList.add('viewing-history');
        } else {
            historyIndicator.textContent = 'Current State';
            historyIndicator.classList.remove('viewing-history');
        }
    }
    
    updateHistoryNavigationButtons() {
        const prevButton = document.getElementById('prevHistoryButton');
        const nextButton = document.getElementById('nextHistoryButton');
        
        if (!prevButton || !nextButton) return;
        
        // Disable prev button if we're at the beginning of history or have no history
        prevButton.disabled = this.historyPosition <= 0 || this.historyStates.length === 0;
        
        // Disable next button if we're at the current state or have no history
        nextButton.disabled = this.historyPosition >= this.historyStates.length - 1 || this.historyStates.length === 0;
    }
    
    saveHistoryState() {
        // Create a deep copy of the current dependency graph
        const graphCopy = new Map();
        this.dependencyGraph.forEach((deps, node) => {
            graphCopy.set(node, [...deps]); // Create a new array with the same values
        });
        
        // Create a state object with the current dependency graph and other relevant information
        const state = {
            dependencyGraph: graphCopy,
            timestamp: new Date(),
            sbomCount: this.uploadedSboms.length
        };
        
        // If we're viewing history, we need to handle this specially
        if (this.viewingHistory) {
            // Restore the current graph before saving
            if (this._currentGraph) {
                this.dependencyGraph = this._currentGraph;
                this._currentGraph = null;
            }
            
            // Reset history viewing state
            this.viewingHistory = false;
            
            // Truncate history at current position and add new state
            this.historyStates = this.historyStates.slice(0, this.historyPosition + 1);
        }
        
        // Add the new state to history
        this.historyStates.push(state);
        this.historyPosition = this.historyStates.length - 1;
        
        // Update the history UI
        this.updateHistoryIndicator();
        this.updateHistoryNavigationButtons();
    }
    
    setupCustomUploadUI() {
        // Upload Custom button
        const uploadCustomButton = document.getElementById('uploadCustomButton');
        if (uploadCustomButton) {
            uploadCustomButton.addEventListener('click', () => this.openCustomUploadPopup());
        }
        
        // Close popup button
        const closePopupButton = document.getElementById('closePopupButton');
        if (closePopupButton) {
            closePopupButton.addEventListener('click', () => this.closeCustomUploadPopup());
        }
        
        // Click outside to close
        const customUploadPopup = document.getElementById('customUploadPopup');
        if (customUploadPopup) {
            customUploadPopup.addEventListener('click', (e) => {
                if (e.target === customUploadPopup) {
                    this.closeCustomUploadPopup();
                }
            });
        }
        
        // Populate available SBOMs list
        this.populateAvailableSbomsList();
        
        // File upload handling
        const sbomFileUpload = document.getElementById('sbomFileUpload');
        if (sbomFileUpload) {
            sbomFileUpload.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.customFileUpload = e.target.files[0];
                    // Clear any selected SBOM from the list
                    this.selectedSbomFile = null;
                    this.updateSelectedSbomUI();
                    console.log(`Custom file selected: ${this.customFileUpload.name}`);
                    
                    // Display preview for the uploaded file
                    this.displayCustomFilePreview(this.customFileUpload);
                }
            });
        }
        
        // Upload Selected SBOM button
        const uploadSelectedSbom = document.getElementById('uploadSelectedSbom');
        if (uploadSelectedSbom) {
            uploadSelectedSbom.addEventListener('click', () => this.processSelectedSbom());
        }
    }
    
    openCustomUploadPopup() {
        const popup = document.getElementById('customUploadPopup');
        if (popup) {
            popup.classList.add('active');
            // Reset selection state
            this.selectedSbomFile = null;
            this.customFileUpload = null;
            this.updateSelectedSbomUI();
            
            // Clear file input
            const fileInput = document.getElementById('sbomFileUpload');
            if (fileInput) {
                fileInput.value = '';
            }
            
            // Reset the preview to initial state
            const sbomPreview = document.getElementById('sbomPreview');
            if (sbomPreview) {
                sbomPreview.innerHTML = `
                    <div class="sbom-title">No SBOM selected</div>
                    <div class="sbom-metadata">Select an SBOM to view details</div>
                    <div class="component-list"></div>
                `;
            }
            
            // Clear validation error
            this.hideValidationError();
        }
    }
    
    closeCustomUploadPopup() {
        const popup = document.getElementById('customUploadPopup');
        if (popup) {
            popup.classList.remove('active');
        }
    }
    
    populateAvailableSbomsList() {
        const sbomFileList = document.getElementById('sbomFileList');
        if (sbomFileList) {
            sbomFileList.innerHTML = this.availableSbomFiles.map(file => {
                return `
                    <div class="sbom-file-item" data-path="${file.path}">
                        <div class="sbom-file-item-name">${file.name}</div>
                    </div>
                `;
            }).join('');
            
            // Add click event listeners to the items
            const items = sbomFileList.querySelectorAll('.sbom-file-item');
            items.forEach(item => {
                item.addEventListener('click', () => {
                    const path = item.dataset.path;
                    this.selectedSbomFile = this.availableSbomFiles.find(file => file.path === path);
                    this.customFileUpload = null; // Clear any custom file upload
                    
                    // Update UI to show selected item
                    this.updateSelectedSbomUI();
                    
                    // Clear file input
                    const fileInput = document.getElementById('sbomFileUpload');
                    if (fileInput) {
                        fileInput.value = '';
                    }
                    
                    // Load and display SBOM details in the preview
                    this.loadAndDisplaySbomPreview(path);
                    
                    console.log(`Selected SBOM: ${this.selectedSbomFile.name}`);
                });
            });
        }
    }
    
    updateSelectedSbomUI() {
        // Clear all selected states
        const items = document.querySelectorAll('.sbom-file-item');
        items.forEach(item => item.classList.remove('selected'));
        
        // If we have a selected file, highlight it
        if (this.selectedSbomFile) {
            const selectedItem = document.querySelector(`.sbom-file-item[data-path="${this.selectedSbomFile.path}"]`);
            if (selectedItem) {
                selectedItem.classList.add('selected');
            }
        }
    }
    
    async loadAndDisplaySbomPreview(path) {
        const sbomPreview = document.getElementById('sbomPreview');
        
        try {
            // Show loading state
            sbomPreview.innerHTML = `
                <div class="sbom-title">Loading...</div>
                <div class="sbom-metadata">Please wait</div>
                <div class="component-list"></div>
            `;
            
            // Load the SBOM data
            const sbomData = await this.loadSbomFromPath(path);
            
            // Display the SBOM data
            this.displaySbomPreview(sbomData, sbomPreview);
            
        } catch (error) {
            console.error('Error loading SBOM preview:', error);
            sbomPreview.innerHTML = `
                <div class="sbom-title">Error</div>
                <div class="sbom-metadata">Failed to load SBOM data</div>
                <div class="component-list"></div>
            `;
        }
    }
    
    displayCustomFilePreview(file) {
        const sbomPreview = document.getElementById('sbomPreview');
        
        // Show loading state
        sbomPreview.innerHTML = `
            <div class="sbom-title">Loading...</div>
            <div class="sbom-metadata">Reading file</div>
            <div class="component-list"></div>
        `;
        
        const reader = new FileReader();
        
        reader.onload = (event) => {
            try {
                const sbomData = JSON.parse(event.target.result);
                this.displaySbomPreview(sbomData, sbomPreview);
            } catch (error) {
                console.error('Error parsing custom file:', error);
                sbomPreview.innerHTML = `
                    <div class="sbom-title">Error</div>
                    <div class="sbom-metadata">Invalid JSON file. Please upload a valid SBOM JSON file.</div>
                    <div class="component-list"></div>
                `;
            }
        };
        
        reader.onerror = () => {
            console.error('Error reading file');
            sbomPreview.innerHTML = `
                <div class="sbom-title">Error</div>
                <div class="sbom-metadata">Failed to read file. Please try again.</div>
                <div class="component-list"></div>
            `;
        };
        
        reader.readAsText(file);
    }

    displaySbomPreview(sbomData, previewElement) {
        // Create dependency visualization
        const dependencyVisualization = sbomData.dependencies
            .map(dep => {
                // Pass the current SBOM context for proper classification
                const componentTagClass = this.getComponentTagClass(dep.ref, sbomData);

                return `
                <div class="dependency-item">
                    <span class="${componentTagClass}">${dep.ref}</span>
                    <span class="dependency-arrow">→</span>
                    <div class="dependency-list">
                        ${dep.dependsOn.map(d => {
                    // Pass the current SBOM context for proper classification
                    const dependencyTagClass = this.getComponentTagClass(d, sbomData);
                    return `<span class="${dependencyTagClass}">${d}</span>`;
                }).join('')}
                    </div>
                </div>
            `;
            }).join('');

        // Update the preview with the data
        previewElement.innerHTML = `
        <div class="sbom-title">${sbomData.metadata.component.purl}</div>
        <div class="sbom-metadata">${sbomData.bomFormat} v${sbomData.specVersion}</div>
        <div class="component-list">
            ${dependencyVisualization ? `<div class="dependency-visualization">${dependencyVisualization}</div>` : ''}
        </div>
    `;
    }

    showValidationError(message) {
        const validationError = document.getElementById('validationError');
        if (validationError) {
            validationError.textContent = message;
            validationError.classList.add('active');
        }
    }
    
    hideValidationError() {
        const validationError = document.getElementById('validationError');
        if (validationError) {
            validationError.textContent = '';
            validationError.classList.remove('active');
        }
    }
    
    async processSelectedSbom() {
        // Check if we have a selected SBOM or a custom file upload
        if (!this.selectedSbomFile && !this.customFileUpload) {
            this.showValidationError('Please select an SBOM file or upload your own.');
            return;
        }
        
        // Get force mode setting from the popup checkbox
        const forceModeCheckbox = document.getElementById('popupForceModeCheckbox');
        const isForceMode = forceModeCheckbox && forceModeCheckbox.checked;
        
        try {
            let sbomData;
            
            // Load the SBOM data
            if (this.selectedSbomFile) {
                // Load from selected file in the list
                sbomData = await this.loadSbomFromPath(this.selectedSbomFile.path);
                console.log(`Loaded SBOM from path: ${this.selectedSbomFile.path}`);
            } else if (this.customFileUpload) {
                // Load from uploaded file
                sbomData = await this.loadSbomFromFile(this.customFileUpload);
                console.log(`Loaded SBOM from uploaded file: ${this.customFileUpload.name}`);
            }
            
            // Set force mode flag based on checkbox
            sbomData.forceMode = isForceMode;
            
            // Validate if the SBOM can be added without force mode
            if (!isForceMode) {
                const validationResult = this.validateSbomForNonForceMode(sbomData);
                if (!validationResult.valid) {
                    this.showValidationError(validationResult.message);
                    return;
                }
            }
            
            // Add the SBOM to the uploaded list and update the dependency graph
            this.uploadedSboms.push(sbomData);
            this.updateDependencyGraph(sbomData);
            
            // Save the current state to history
            this.saveHistoryState();
            
            this.updateDisplay();
            this.animateGraphUpdate();
            this.updateStageIndicator();
            this.updateProgress();
            
            // Show notification if this is the first SBOM added
            if (this.uploadedSboms.length === 1) {
                this.showSbomAddedNotification(sbomData);
            }
            
            // Close the popup
            this.closeCustomUploadPopup();
            
            console.log(`SBOM uploaded successfully with force mode ${isForceMode ? 'enabled' : 'disabled'}`);
        } catch (error) {
            console.error('Error processing selected SBOM:', error);
            this.showValidationError(`Error processing SBOM: ${error.message}`);
        }
    }
    
    async loadSbomFromPath(path) {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`Failed to load ${path}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error loading SBOM from path ${path}:`, error);
            throw error;
        }
    }
    
    async loadSbomFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    resolve(data);
                } catch (error) {
                    reject(new Error('Invalid JSON file. Please upload a valid SBOM JSON file.'));
                }
            };
            
            reader.onerror = () => {
                reject(new Error('Error reading file. Please try again.'));
            };
            
            reader.readAsText(file);
        });
    }
    
    validateSbomForNonForceMode(sbom) {
        // If there are no existing nodes, any SBOM is valid
        if (this.dependencyGraph.size === 0) {
            return { valid: true };
        }
        
        // Check if any dependencies in the SBOM would modify existing dependencies
        for (const dep of sbom.dependencies) {
            const nodeRef = dep.ref;
            
            // If the node already exists in the dependency graph
            if (this.dependencyGraph.has(nodeRef)) {
                const existingDeps = this.dependencyGraph.get(nodeRef);
                const newDeps = dep.dependsOn;
                
                // Check if any existing dependencies would be modified
                // This happens if:
                // 1. The new dependencies are different from the existing ones
                // 2. The new dependencies would replace existing ones
                
                // Check if the new dependencies are a subset of the existing ones
                const wouldModify = newDeps.some(newDep => !existingDeps.includes(newDep)) ||
                                    existingDeps.length !== newDeps.length;
                
                if (wouldModify) {
                    return {
                        valid: false,
                        message: `Cannot upload without Force Mode: This SBOM would modify existing dependencies for node "${nodeRef}". Enable Force Mode to allow this modification.`
                    };
                }
            }
        }
        
        // If we get here, the SBOM is valid for non-force mode
        return { valid: true };
    }
    
    // This method is no longer needed as we've replaced the force mode checkbox with a popup
    // Keeping an empty implementation for backward compatibility
    updateForceModeUI(isEnabled) {
        // No longer used
    }

    nextStage() {
        // Check if data is loaded and there are more stages
        if (this.sbomData.length > 0 && this.currentStage < this.sbomData.length - 1) {
            this.currentStage++;
            const sbom = this.sbomData[this.currentStage];
            
            // Note: Force mode is now handled in the custom upload popup
            // The predefined sequence uses the forceMode flag set during loading
            
            this.uploadedSboms.push(sbom);
            this.updateDependencyGraph(sbom);
            
            // Save the current state to history
            this.saveHistoryState();
            
            this.updateDisplay();
            this.animateGraphUpdate();
            this.updateStageIndicator();
            this.updateProgress();
            
            // Show notification if this is the first SBOM added
            if (this.uploadedSboms.length === 1) {
                this.showSbomAddedNotification(sbom);
            }
        } else if (this.sbomData.length === 0) {
            console.warn('Cannot proceed to next stage: SBOM data not loaded yet');
        }
    }
    
    showSbomAddedNotification(sbom) {
        // Create notification element if it doesn't exist
        let notification = document.getElementById('sbomAddedNotification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'sbomAddedNotification';
            notification.className = 'sbom-notification';
            document.body.appendChild(notification);
        }
        
        // Set notification content
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-title">SBOM Added</div>
                <div class="notification-message">Added SBOM: ${sbom.metadata.component.purl}</div>
            </div>
            <button class="notification-close">&times;</button>
        `;
        
        // Add close button functionality
        const closeButton = notification.querySelector('.notification-close');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                notification.classList.remove('active');
            });
        }
        
        // Show notification
        notification.classList.add('active');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            notification.classList.remove('active');
        }, 5000);
    }

    updateDependencyGraph(sbom) {
        // Check if this is a force mode SBOM
        const isForceMode = sbom.forceMode === true;
        
        // Process dependencies from the new SBOM
        sbom.dependencies.forEach(dep => {
            if (!this.dependencyGraph.has(dep.ref)) {
                // Node doesn't exist yet, create it
                this.dependencyGraph.set(dep.ref, []);
            }
            
            if (isForceMode) {
                // In force mode, replace existing dependencies for this node
                console.log(`Force mode: Replacing dependencies for ${dep.ref}`);
                // Store the new dependencies
                this.dependencyGraph.set(dep.ref, [...dep.dependsOn]);
            } else {
                // Regular mode: add new dependencies without replacing existing ones
                dep.dependsOn.forEach(dependency => {
                    if (!this.dependencyGraph.get(dep.ref).includes(dependency)) {
                        this.dependencyGraph.get(dep.ref).push(dependency);
                    }
                });
            }
        });
        
        // Log the updated dependency graph
        console.log('Updated dependency graph:', this.dependencyGraph);
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
                .map(dep => {
                    // Determine the appropriate tag class
                    const componentTagClass = this.getComponentTagClass(dep.ref);

                    return `
                    <div class="dependency-item">
                        <span class="${componentTagClass}">${dep.ref}</span>
                        <span class="dependency-arrow">→</span>
                        <div class="dependency-list">
                            ${dep.dependsOn.map(d => {
                        // Determine the appropriate tag class for each dependency
                        const dependencyTagClass = this.getComponentTagClass(d);
                        return `<span class="${dependencyTagClass}">${d}</span>`;
                    }).join('')}
                        </div>
                    </div>
                `;
                }).join('');

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
                .map(dep => {
                    // Pass the current SBOM context for proper classification
                    const componentTagClass = this.getComponentTagClass(dep.ref, sbom);

                    return `
                    <div class="dependency-item">
                        <span class="${componentTagClass}">${dep.ref}</span>
                        <span class="dependency-arrow">→</span>
                        <div class="dependency-list">
                            ${dep.dependsOn.map(d => {
                        // Pass the current SBOM context for proper classification
                        const dependencyTagClass = this.getComponentTagClass(d, sbom);
                        return `<span class="${dependencyTagClass}">${d}</span>`;
                    }).join('')}
                        </div>
                    </div>
                `;
                }).join('');

            // Check if this is a file that could be loaded with force mode
            const isForceCandidate = sbom.forceMode === true;

            nextSbom.innerHTML = `
            <div class="sbom-title">${sbom.metadata.component.purl}${isForceCandidate ? ' <span class="force-candidate">(Force candidate)</span>' : ''}</div>
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
                .map(dep => {
                    // Determine the appropriate tag class
                    const componentTagClass = this.getComponentTagClass(dep.ref);

                    return `
                    <div class="dependency-item">
                        <span class="${componentTagClass}" style="font-size: 10px; padding: 1px 4px;">${dep.ref}</span>
                        <span class="dependency-arrow" style="font-size: 10px;">→</span>
                        <div class="dependency-list">
                            ${dep.dependsOn.map(d => {
                        // Determine the appropriate tag class for each dependency
                        const dependencyTagClass = this.getComponentTagClass(d);
                        return `<span class="${dependencyTagClass}" style="font-size: 9px; padding: 1px 3px;">${d}</span>`;
                    }).join('')}
                        </div>
                    </div>
                `;
                }).join('');

            // Check if this SBOM was uploaded with force mode
            const forceModeIndicator = sbom.forceMode ?
                `<span class="force-mode-indicator" style="background-color: #ff5722; color: white; font-size: 9px; padding: 1px 4px; border-radius: 3px; margin-left: 5px;">FORCE</span>` : '';

            return `
            <div class="uploaded-item${sbom.forceMode ? ' force-mode' : ''}" data-index="${index}">
                <div style="font-weight: 600; margin-bottom: 5px;">
                    Stage ${index + 1}: ${sbom.metadata.component.purl} ${forceModeIndicator}
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

    getComponentTagClass(componentRef, currentSbom = null) {
        if (currentSbom) {
            // Check if it's the root component (from metadata)
            if (currentSbom.metadata.component.purl === componentRef ||
                currentSbom.metadata.component['bom-ref'] === componentRef) {
                return 'component-tag';
            }

            return 'dependency-tag';
        }

        for (const sbom of this.uploadedSboms) {
            console.log(componentRef, sbom.metadata.component.purl);
            if (sbom.metadata.component.purl === componentRef ||
                sbom.metadata.component['bom-ref'] === componentRef) {
                return 'component-tag';
            }
        }

        return 'dependency-tag';
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
        // Log the nodes that will be rendered
        console.log('Rendering nodes:', Array.from(this.nodePositions.keys()));
        
        // Collect only metadata components (these should be red)
        const mainComponents = new Set();
        
        // Add only components from metadata sections
        this.uploadedSboms.forEach(sbom => {
            if (sbom.metadata && sbom.metadata.component && sbom.metadata.component.purl) {
                mainComponents.add(sbom.metadata.component.purl);
            }
        });
        
        console.log('Main components (metadata only):', Array.from(mainComponents));
        
        this.nodePositions.forEach((pos, node) => {
            const nodeEl = document.createElement('div');
            nodeEl.className = 'node';
            nodeEl.textContent = node;
            nodeEl.style.left = `${pos.x}px`;
            nodeEl.style.top = `${pos.y}px`;
            nodeEl.style.transform = 'translate(-50%, -50%)';
            
            // Color main components red, all others green
            if (mainComponents.has(node)) {
                nodeEl.classList.add('main-component');
            } else {
                nodeEl.classList.add('other-component');
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
        const clickedItem = document.querySelector(`[data-index="${index}"]`);
        const sbom = this.uploadedSboms[index];
        
        // Check if this SBOM is already highlighted
        if (this.highlightedSboms.has(index)) {
            // If it is, unhighlight it
            this.highlightedSboms.delete(index);
            clickedItem.classList.remove('active');
            
            // Refresh all node highlights
            this.refreshNodeHighlights();
        } else {
            // If it's not, highlight it
            this.highlightedSboms.add(index);
            clickedItem.classList.add('active');
            
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
    
    refreshNodeHighlights() {
        // Clear all node highlights
        document.querySelectorAll('.node').forEach(node => {
            node.classList.remove('highlighted');
        });
        
        // If there are no highlighted SBOMs, we're done
        if (this.highlightedSboms.size === 0) {
            return;
        }
        
        // Get all nodes that should be highlighted based on the highlighted SBOMs
        const nodesToHighlight = new Set();
        
        this.highlightedSboms.forEach(index => {
            const sbom = this.uploadedSboms[index];
            const relevantNodes = [
                sbom.metadata.component.purl, 
                ...sbom.components.map(c => c.purl)
            ];
            
            relevantNodes.forEach(node => nodesToHighlight.add(node));
        });
        
        // Highlight the nodes
        document.querySelectorAll('.node').forEach(node => {
            if (nodesToHighlight.has(node.textContent)) {
                node.classList.add('highlighted');
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SBOMVisualizer();
});

