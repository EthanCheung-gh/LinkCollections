import { ipcMain, dialog, app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'
import { readJsonFile, writeJsonFile } from '../utils/storage'

interface Bookmark {
  id: string
  url: string
  title: string
  description: string
  favicon: string
  color: string
  folderId: string
  tags: string[]
  visitCount: number
  lastVisited: string | null
  createdAt: string
  updatedAt: string
}

interface Folder {
  id: string
  name: string
  icon: string | null
  color: string
  createdAt: string
  order: number
}

interface Tag {
  id: string
  name: string
  color: string
  createdAt: string
}

const BOOKMARKS_FILE = 'bookmarks.json'
const FOLDERS_FILE = 'folders.json'
const TAGS_FILE = 'tags.json'

function getBookmarks(): Bookmark[] {
  return readJsonFile<Bookmark[]>(BOOKMARKS_FILE, [])
}

function getFolders(): Folder[] {
  return readJsonFile<Folder[]>(FOLDERS_FILE, [])
}

function getTags(): Tag[] {
  return readJsonFile<Tag[]>(TAGS_FILE, [])
}

function saveBookmarks(bookmarks: Bookmark[]): boolean {
  return writeJsonFile(BOOKMARKS_FILE, bookmarks)
}

function saveFolders(folders: Folder[]): boolean {
  return writeJsonFile(FOLDERS_FILE, folders)
}

function saveTags(tags: Tag[]): boolean {
  return writeJsonFile(TAGS_FILE, tags)
}

function generateNetscapeHtml(bookmarks: Bookmark[], folders: Folder[]): string {
  const now = new Date().toISOString()
  const timestamp = Math.floor(new Date(now).getTime() / 1000)

  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n`
  html += `<!-- This is an automatically generated file.\n`
  html += `     It will be read and overwritten.\n`
  html += `     DO NOT EDIT! -->\n`
  html += `<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n`
  html += `<TITLE>Bookmarks</TITLE>\n`
  html += `<H1>Bookmarks</H1>\n`
  html += `<DL><p>\n`

  const bookmarksByFolder = new Map<string, Bookmark[]>()
  bookmarksByFolder.set('', [])
  folders.forEach(f => bookmarksByFolder.set(f.id, []))

  bookmarks.forEach(b => {
    const folderBookmarks = bookmarksByFolder.get(b.folderId)
    if (folderBookmarks) {
      folderBookmarks.push(b)
    } else {
      bookmarksByFolder.get('')?.push(b)
    }
  })

  const rootFolders = folders.filter(f => !f.id || !folders.some(parent => parent.id === f.id))
  rootFolders.forEach(folder => {
    html += `    <DT><H3 ADD_DATE="${timestamp}">${escapeHtml(folder.name)}</H3>\n`
    html += `    <DL><p>\n`

    const subFolders = folders.filter(
      f => f.id !== folder.id && folders.some(p => p.id === f.id && p.name === folder.name)
    )
    subFolders.forEach(subFolder => {
      html += `        <DT><H3 ADD_DATE="${timestamp}">${escapeHtml(subFolder.name)}</H3>\n`
      html += `        <DL><p>\n`
      const folderBookmarks = bookmarksByFolder.get(subFolder.id) || []
      folderBookmarks.forEach(bookmark => {
        html += `            <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${timestamp}">${escapeHtml(bookmark.title)}</A>\n`
      })
      html += `        </DL><p>\n`
    })

    const folderBookmarks = bookmarksByFolder.get(folder.id) || []
    folderBookmarks.forEach(bookmark => {
      html += `        <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${timestamp}">${escapeHtml(bookmark.title)}</A>\n`
    })
    html += `    </DL><p>\n`
  })

  const uncategorized = bookmarksByFolder.get('') || []
  uncategorized.forEach(bookmark => {
    html += `    <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${timestamp}">${escapeHtml(bookmark.title)}</A>\n`
  })

  html += `</DL><p>\n`

  return html
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseNetscapeHtml(html: string): {
  folders: Map<string, string>
  bookmarks: Array<{ title: string; url: string; folderId: string }>
} {
  const folders = new Map<string, string>()
  const bookmarks: Array<{ title: string; url: string; folderId: string }> = []

  const dtRegex = /<DT>(?:<H3[^>]*>([^<]+)<\/H3>|(<A[^>]+HREF="([^"]+)"[^>]*>([^<]+)<\/A>))/gi
  const folderStack: Array<{ name: string; id: string }> = []
  let currentFolderId = ''
  let folderCounter = 0

  let match
  while ((match = dtRegex.exec(html)) !== null) {
    if (match[1]) {
      const folderName = match[1].trim()
      const folderId = `imported_${++folderCounter}`
      folders.set(folderId, folderName)
      currentFolderId = folderId
      folderStack.push({ name: folderName, id: folderId })
    } else if (match[2]) {
      const url = match[3]?.trim() || ''
      const title = match[4]?.trim() || url
      if (url) {
        bookmarks.push({ title, url, folderId: currentFolderId })
      }
    }
  }

  return { folders, bookmarks }
}

export function registerImportExportHandlers(): void {
  ipcMain.handle('export-data', async (_, format: 'json' | 'html') => {
    try {
      const bookmarks = getBookmarks()
      const folders = getFolders()
      const tags = getTags()

      const defaultPath = path.join(
        app.getPath('documents'),
        `LinkCollection_Bookmarks_${new Date().toISOString().slice(0, 10)}.${format}`
      )

      const result = await dialog.showSaveDialog({
        defaultPath,
        filters:
          format === 'json'
            ? [{ name: 'JSON Files', extensions: ['json'] }]
            : [{ name: 'HTML Files', extensions: ['html'] }]
      })

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true }
      }

      if (format === 'json') {
        const exportData = {
          version: '1.1.0',
          exportedAt: new Date().toISOString(),
          bookmarks,
          folders,
          tags
        }
        fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')
      } else {
        const html = generateNetscapeHtml(bookmarks, folders)
        fs.writeFileSync(result.filePath, html, 'utf-8')
      }

      return { success: true, filePath: result.filePath }
    } catch (error) {
      console.error('Export error:', error)
      throw error
    }
  })

  ipcMain.handle(
    'import-data',
    async (_, format: 'json' | 'html', mergeMode: 'replace' | 'merge') => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters:
            format === 'json'
              ? [{ name: 'JSON Files', extensions: ['json'] }]
              : [{ name: 'HTML Files', extensions: ['html', 'htm'] }]
        })

        if (result.canceled || !result.filePaths[0]) {
          return { success: false, canceled: true }
        }

        const content = fs.readFileSync(result.filePaths[0], 'utf-8')

        if (format === 'json') {
          const data = JSON.parse(content)

          if (!data.bookmarks || !Array.isArray(data.bookmarks)) {
            throw new Error('Invalid JSON format: missing bookmarks array')
          }

          const existingBookmarks = mergeMode === 'merge' ? getBookmarks() : []
          const existingFolders = mergeMode === 'merge' ? getFolders() : []
          const existingTags = mergeMode === 'merge' ? getTags() : []

          const folderIdMap = new Map<string, string>()
          const tagIdMap = new Map<string, string>()

          const newFolders = (data.folders || []).map((f: Folder) => {
            const newId = uuidv4()
            folderIdMap.set(f.id, newId)
            return {
              id: newId,
              name: f.name,
              icon: f.icon || null,
              color: f.color || '#3B82F6',
              createdAt: f.createdAt || new Date().toISOString(),
              order: f.order || 0
            }
          })

          const newTags = (data.tags || []).map((t: Tag) => {
            const newId = uuidv4()
            tagIdMap.set(t.id, newId)
            return {
              id: newId,
              name: t.name,
              color: t.color || '#3B82F6',
              createdAt: t.createdAt || new Date().toISOString()
            }
          })

          const newBookmarks = (data.bookmarks || []).map((b: Bookmark) => ({
            id: uuidv4(),
            url: b.url || '',
            title: b.title || b.url || '',
            description: b.description || '',
            favicon: b.favicon || '',
            color: b.color || '#3B82F6',
            folderId: folderIdMap.get(b.folderId) || '',
            tags: (b.tags || []).map((t: string) => tagIdMap.get(t) || t),
            visitCount: 0,
            lastVisited: null,
            createdAt: b.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }))

          const allFolders = [...existingFolders, ...newFolders]
          const allTags = [...existingTags, ...newTags]
          const allBookmarks = [...existingBookmarks, ...newBookmarks]

          saveFolders(allFolders)
          saveTags(allTags)
          saveBookmarks(allBookmarks)

          return {
            success: true,
            imported: {
              bookmarks: newBookmarks.length,
              folders: newFolders.length,
              tags: newTags.length
            }
          }
        } else {
          const { folders, bookmarks } = parseNetscapeHtml(content)

          const existingBookmarks = mergeMode === 'merge' ? getBookmarks() : []
          const existingFolders = mergeMode === 'merge' ? getFolders() : []

          const newFolders: Folder[] = []
          folders.forEach((name, id) => {
            newFolders.push({
              id,
              name,
              icon: null,
              color: '#3B82F6',
              createdAt: new Date().toISOString(),
              order: newFolders.length
            })
          })

          const newBookmarks = bookmarks.map(b => ({
            id: uuidv4(),
            url: b.url,
            title: b.title,
            description: '',
            favicon: '',
            color: '#3B82F6',
            folderId: b.folderId || '',
            tags: [],
            visitCount: 0,
            lastVisited: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }))

          const allFolders = [...existingFolders, ...newFolders]
          const allBookmarks = [...existingBookmarks, ...newBookmarks]

          saveFolders(allFolders)
          saveBookmarks(allBookmarks)

          return {
            success: true,
            imported: {
              bookmarks: newBookmarks.length,
              folders: newFolders.length,
              tags: 0
            }
          }
        }
      } catch (error) {
        console.error('Import error:', error)
        throw error
      }
    }
  )
}
