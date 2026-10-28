# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-23

### Added

#### Core Features

- 📁 Folder-based bookmark organization system
- 🏷️ Tag-based bookmark filtering and management
- 🎴 Card view mode for visual bookmark display
- 📋 List view mode for detailed bookmark information
- 🔍 Fast search functionality across titles, URLs, and descriptions
- 📊 Statistics dashboard with ECharts visualization
- ⚙️ Settings management interface
- 🎨 Theme switching (Light/Dark mode)
- 🌐 Language support (Chinese/English)
- 🖥️ Multi-browser configuration support
- 📈 Visit tracking and statistics
- 🎨 Custom bookmark colors
- 🔄 Auto-fetch website favicons
- 🗑️ Clear all data functionality

#### UI Components

- Bookmark card with favicon support
- Bookmark list view with sortable columns
- Sidebar navigation
- Search results panel
- Statistics charts (bar chart for bookmarks by folder)
- Settings interface with multiple sections
- Modal dialogs for adding/editing bookmarks
- Folder management UI
- Tag management UI

#### Security

- Content Security Policy (CSP) configuration
- Context isolation enabled
- Node integration disabled in renderer process

### Fixed

- Missing App.vue file causing application to not load
- Stats view not showing all folders (now includes empty folders)
- Favicon loading errors causing broken images (now falls back to default icon)
- Console log statements cluttering the console output

### Improved

- Favicon loading with graceful fallback on errors
- Clean console output for production use
- Responsive layout for different screen sizes
- Performance optimizations with lazy loading

### Technical Details

- Built with Electron 28.0.0
- Vue 3.4.0 with Composition API
- TypeScript 5.3.3
- Element Plus 2.5.0
- Pinia 2.1.7 for state management
- ECharts 5.4.3 for data visualization
- UnoCSS 0.58.0 for styling

---

## [1.1.0] - 2025-02-16

### Added

- Import/Export functionality (JSON and HTML formats)
- Favicon service options (Domestic/foreign)
- Multiple theme color options (7 preset colors)
- Custom theme color support
- Root domain extraction for favicon

### Improved

- CSP policy updated for favicon services

---

## [Unreleased]

### Planned Features (v1.2.0)

- Unit tests for core functionality
- E2E tests for critical user flows
- Cloud sync functionality
- Browser extension
- Keyboard shortcuts
- Batch operations
- Bookmark grouping
- Recycle bin functionality
