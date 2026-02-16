import axios from 'axios';

const LAB_BOOK_SEARCH_API = 'https://lab.ndl.go.jp/dl/api/book/search';
const LAB_PAGE_SEARCH_API = 'https://lab.ndl.go.jp/dl/api/page/search';

export interface NDLResult {
    title: string;
    pid: string;
    page: string;
    snippet: string;
    link: string;
}

/**
 * プロアクティブな検索機能：タイトル検索とキーワード検索を組み合わせて資料を探す
 */
export async function searchHistoricalMaterials(query: string, focusKeywords: string | string[]): Promise<NDLResult[]> {
    try {
        const keywords = Array.isArray(focusKeywords) ? focusKeywords : [focusKeywords];
        console.log(`NDL Proactive Search: query="${query}", focusKeywords=${JSON.stringify(keywords)}`);

        // 1. 書籍検索
        let bookResponse = await axios.get(LAB_BOOK_SEARCH_API, {
            params: {
                keyword: query,
                size: 15
            }
        });

        let books = bookResponse.data.list || [];

        // ヒットしない場合、query自体をキーワードに含めて再試行（もしqueryが具体的すぎる場合）
        if (books.length === 0) {
            console.log("No books found with exact query, trying fallback...");
            const fallbackQuery = query.split(' ')[0]; // 最初の単語だけで試す
            bookResponse = await axios.get(LAB_BOOK_SEARCH_API, {
                params: { keyword: fallbackQuery, size: 10 }
            });
            books = bookResponse.data.list || [];
        }

        const results: NDLResult[] = [];
        const seenPids = new Set<string>();

        for (const book of books) {
            if (seenPids.has(book.id)) continue;

            // --- 手法A: Page API での精密検索 ---
            for (const kw of keywords) {
                try {
                    const pageResponse = await axios.get(LAB_PAGE_SEARCH_API, {
                        params: {
                            'f-book': book.id,
                            'q-contents': kw,
                            size: 2
                        }
                    });

                    const pages = pageResponse.data || [];
                    if (pages.length > 0) {
                        for (const page of pages) {
                            results.push({
                                title: book.title,
                                pid: book.id,
                                page: page.page,
                                snippet: cleanSnippet(page.snippet),
                                link: `https://dl.ndl.go.jp/pid/${book.id}/${page.page}`
                            });
                        }
                    }
                } catch (e) {
                    // ignore error for single book
                }
                if (results.length >= 8) break;
            }

            // --- 手法B: Book Searchのhighlightsを使用 ---
            if (results.filter(r => r.pid === book.id).length === 0 && book.highlights && book.highlights.length > 0) {
                book.highlights.forEach((hl: string) => {
                    const pageMatch = hl.match(/\((\d+)\.jp2\)/);
                    const pageNum = pageMatch ? parseInt(pageMatch[1]).toString() : '1';
                    results.push({
                        title: book.title,
                        pid: book.id,
                        page: pageNum,
                        snippet: cleanSnippet(hl),
                        link: `https://dl.ndl.go.jp/pid/${book.id}/${pageNum}`
                    });
                });
            }

            seenPids.add(book.id);
            if (results.length >= 10) break;
        }

        return results.filter(r => r.snippet.length > 5);
    } catch (error) {
        console.error('Error in searchHistoricalMaterials:', error);
        return [];
    }
}

/**
 * ランダムに怪異資料を一つ取得する
 */
export async function searchRandomMaterial(): Promise<NDLResult[]> {
    try {
        const randomKeywords = ['怪談', '奇談', '実録', '百物語', '怪異', '化物', '幽霊', '笑話'];
        const kw = randomKeywords[Math.floor(Math.random() * randomKeywords.length)];
        const from = Math.floor(Math.random() * 50);

        const response = await axios.get(LAB_BOOK_SEARCH_API, {
            params: {
                keyword: kw,
                from: from,
                size: 5
            }
        });

        const books = response.data.list || [];
        if (books.length === 0) return [];

        const book = books[Math.floor(Math.random() * books.length)];
        // 適当なキーワードでスニペットを出す
        const focusKw = ['怪', '鬼', '女', '男', '死', '霊'];
        return await searchHistoricalMaterials(book.title, focusKw);

    } catch (e) {
        console.error('Error in searchRandomMaterial:', e);
        return [];
    }
}

function cleanSnippet(text: string): string {
    if (!text) return '';
    return text
        .replace(/<em[^>]*>/g, '')
        .replace(/<\/em>/g, '')
        .replace(/&#x2F;/g, '/')
        .replace(/\s+/g, ' ')
        .trim();
}
