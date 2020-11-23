call plug#begin()
Plug 'SirVer/ultisnips'
Plug 'ryanoasis/vim-devicons'
Plug 'jkramer/vim-checkbox'
Plug 'junegunn/vim-emoji'
Plug 'vim-airline/vim-airline'
Plug 'vuciv/vim-bujo'
Plug 'fatih/vim-go', { 'do': ':GoUpdateBinaries' }
Plug 'briancollins/vim-jst'
Plug 'SirVer/ultisnips'

Plug 'junegunn/goyo.vim'
Plug 'vim-airline/vim-airline-themes'
Plug 'vimwiki/vimwiki'
Plug 'iamcco/markdown-preview.nvim', { 'do': { -> mkdp#util#install() }, 'for': ['markdown', 'vim-plug']}
Plug 'luochen1990/rainbow'
Plug 'mhinz/vim-startify'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-repeat'

Plug 'airblade/vim-gitgutter'
Plug 'othree/yajs.vim'
Plug 'leafgarland/typescript-vim' " TypeScript syntax
" Plug 'herringtondarkholme/yats.vim'
Plug 'MaxMEllon/vim-jsx-pretty'
Plug 'peitalin/vim-jsx-typescript'

Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-fugitive'
Plug 'christoomey/vim-tmux-navigator'
Plug '/usr/local/opt/fzf'
Plug 'junegunn/fzf.vim'
" Plug 'arcticicestudio/nord-vim', { 'branch': 'develop' }
Plug 'cocopon/iceberg.vim'
Plug 'gkeep/iceberg-dark'
" Plug 'morhetz/gruvbox'
" Plug 'dracula/vim', { 'as': 'dracula' }
" Plug 'Shougo/vimproc.vim', {'do' : 'make'}
Plug 'preservim/nerdtree'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'jiangmiao/auto-pairs'
Plug 'Xuyuanp/nerdtree-git-plugin'
Plug 'dense-analysis/ale'
Plug 'jremmen/vim-ripgrep'
call plug#end()

set guifont=Fira\ Code:h12
syntax enable
set background=dark
set termguicolors
let mapleader = "\<Space>"
" colorscheme gruvbox
" colorscheme nord
colorscheme iceberg
" colorscheme dracula
set number relativenumber
" let g:airline_theme='nord'
let g:airline_theme='icebergDark'

set title                                               " tab title as file name
set noshowmode                                          " dont show current mode below statusline
au BufEnter * set fo-=c fo-=r fo-=o                     " stop annoying auto commenting on new lines
hi clear CursorLineNr                                   " use the theme color for relative number


" performance tweaks
set nocursorline
set nocursorcolumn
set scrolljump=5
set lazyredraw
set redrawtime=10000
set synmaxcol=180
set re=1
set cursorline

" required by coc
set hidden
set nobackup
set nowritebackup
set cmdheight=2
set updatetime=300
set shortmess+=c
set signcolumn=yes

" trigger `autoread` when files changes on disk
set autoread
autocmd FocusGained,BufEnter,CursorHold,CursorHoldI * if mode() != 'c' | checktime | endif

" notification after file change
autocmd FileChangedShellPost *
\ echohl WarningMsg | echo "File changed on disk. Buffer reloaded." | echohl None

let g:python3_host_prog = '/usr/local/bin/python3'

" Java completion
autocmd FileType java setlocal omnifunc=javacomplete#Complete
autocmd FileType java JCEnable

let g:UltiSnipsEditSplit="vertical"

let g:UltiSnipsSnippetDirectories = ['~/.vim/UltiSnips', 'UltiSnips']
let g:UltiSnipsSnippetsDir="~/.vim/UltiSnips"

" ==========FZF==========
let g:fzf_layout = { 'window': 'call CreateCenteredFloatingWindow()' }
let $FZF_DEFAULT_OPTS="--reverse "

" files window with preview
command! -bang -nargs=? -complete=dir GFiles
        \ call fzf#vim#files(<q-args>, fzf#vim#with_preview(), <bang>0)

function! RipgrepFzf(query, fullscreen)
    let command_fmt = 'rg --column --line-number --no-heading --color=always --smart-case %s || true'
    let initial_command = printf(command_fmt, shellescape(a:query))
    let reload_command = printf(command_fmt, '{q}')
    let spec = {'options': ['--phony', '--query', a:query, '--bind', 'change:reload:'.reload_command]}
    call fzf#vim#grep(initial_command, 1, fzf#vim#with_preview(spec), a:fullscreen)
endfunction
command! -nargs=* -bang Rgp call RipgrepFzf(<q-args>, <bang>0)

" floating fzf window with borders
function! CreateCenteredFloatingWindow()
    let width = min([&columns - 4, max([80, &columns - 20])])
    let height = min([&lines - 4, max([20, &lines - 10])])
    let top = ((&lines - height) / 2) - 1
    let left = (&columns - width) / 2
    let opts = {'relative': 'editor', 'row': top, 'col': left, 'width': width, 'height': height, 'style': 'minimal'}

    let top = "╭" . repeat("─", width - 2) . "╮"
    let mid = "│" . repeat(" ", width - 2) . "│"
    let bot = "╰" . repeat("─", width - 2) . "╯"
    let lines = [top] + repeat([mid], height - 2) + [bot]
    let s:buf = nvim_create_buf(v:false, v:true)
    call nvim_buf_set_lines(s:buf, 0, -1, v:true, lines)
    call nvim_open_win(s:buf, v:true, opts)
    set winhl=Normal:Floating
    let opts.row += 1
    let opts.height -= 2
    let opts.col += 2
    let opts.width -= 4
    call nvim_open_win(nvim_create_buf(v:false, v:true), v:true, opts)
    au BufWipeout <buffer> exe 'bw '.s:buf
    execute 'set winblend=' . 15
endfunction




" ========== AIRLINE ==========
let g:airline_section_x=''
let g:airline_section_y=''
let g:airline_section_z=''
let g:coc_global_extensions = [
  \ 'coc-html',
  \ 'coc-snippets',
  \ 'coc-pairs',
  \ 'coc-tsserver',
  \ 'coc-json', 
  \ 'coc-eslint',
  \ 'coc-prettier',
  \ 'coc-tslint',
  \ ]



" ========== ALE ==========
let g:ale_sign_highlight_linenrs = 1
let g:ale_linters = {'python': ['flake8', 'pylint'], 'rust': ['rls'], 'javascript': ['eslint'],'typescript': ['tsserver', 'tslint']}
let g:ale_sign_error = emoji#for('no_entry_sign')
let g:ale_sign_warning = emoji#for('poop')
let g:formatdef_eslint = '"eslint-formatter"'
let g:formatters_javascript = ['prettier', 'eslint']
let g:ale_fix_on_save = 1
let g:ale_fixers = {'javascript': ['eslint'], 'typescript': ['prettier'],'json': ['jq'], 'html': ['prettier'], 'scss': ['stylelint'], 'less': ['stylelint'], 'css': ['stylelint'], 'python': ['black', 'yapf'], 'rust': ['rustfmt']}
let g:ale_set_highlights = 1
let g:ale_lint_on_enter = 1
let g:ale_lint_on_text_changed = 'always'
let g:ale_python_flake8_executable = 'python3'
let g:ale_sign_column_always = 1
let g:ale_echo_cursor = 1




" ========== Scrolling ==========
set mouse=v
set scrolloff=8         "Start scrolling when we're 8 lines away from margins
set sidescrolloff=15
set sidescroll=1
" Highlight matching pairs of brackets. Use the '%' character to jump between them.
set matchpairs+=<:>

set relativenumber

set autoindent
set smartindent
set smarttab
set shiftwidth=2
set softtabstop=2
set tabstop=2
set expandtab
" always uses spaces instead of tab characters
set expandtab

"" Fix backspace indent
set backspace=indent,eol,start
set noswapfile
set nobackup
set nowb




let g:nord_cursor_line_number_background = 1
" Trigger configuration. Do not use <tab> if you use https://github.com/Valloric/YouCompleteMe.
let g:UltiSnipsExpandTrigger="<tab>"  " use <Tab> trigger autocompletion
" do not close the preview tab when switching to other buffers

" Add spaces after comment delimiters by default
let g:NERDSpaceDelims = 1
let g:NERDCommentEmptyLines = 1
" Use compact syntax for prettified multi-line comments
let g:NERDCompactSexyComs = 1
let NERDTreeShowHidden=1
let g:airline_powerline_fonts = 1


set  runtimepath+=/usr/local/opt/fzf

au BufNewFile,BufRead *.ts setlocal filetype=typescript
au BufNewFile,BufRead *.tsx setlocal filetype=typescript.tsx
autocmd BufEnter *.{js,jsx,ts,tsx} :syntax sync fromstart
autocmd BufLeave *.{js,jsx,ts,tsx} :syntax sync clear


let g:rainbow_active = 1
let g:rainbow_conf = {
\	'guifgs': ['gold', 'orchid', 'LightSkyBlue']
\}



" Add `:OR` command for organize imports of the current buffer.
function! ShowDocIfNoDiagnostic(timer_id)
  if (coc#util#has_float() == 0)
    silent call CocActionAsync('doHover')
  endif
endfunction


function! s:show_hover_doc()
  call timer_start(500, 'ShowDocIfNoDiagnostic')
endfunction

" ========== VIMWIKI ==========
let g:vimwiki_list = [{'path': '~/Sync/notes',
                      \ 'syntax': 'markdown', 'ext': '.md'}]
autocmd BufRead,BufNewFile ~/Sync/notes/*.md :Goyo 80
let g:vimwiki_global_ext = 0
let g:vimwiki_ext2syntax = {'.md': 'markdown', '.markdown': 'markdown', '.mdown': 'markdown'}
set nocompatible
filetype plugin indent on
syntax on
let g:vimwiki_global_ext = 0


" ========== BUJO ==========
nnoremap <leader>td :Todo<cr>
nmap <C-s> <Plug>BujoAddnormal
imap <C-q> <Plug>BujoAddinsert
nmap <C-q> <Plug>BujoChecknormal
imap <C-q> <Plug>BujoCheckinsert
let g:bujo#window_width = 40


" ========== MAPPINGS ==========
"Turn quit into \q
nnoremap <leader>q :q!<cr>
" Turn save quit into \z
nnoremap <leader>z :wq<cr>
"turn w into \w
nnoremap <leader>w :w<cr>
nnoremap <C-p> :GFiles<return>
nnoremap <leader>p :Rgp<return>
map <C-n> :NERDTreeToggle<CR>
let NERDTreeDirArrows = 1
vmap ++ <plug>NERDCommenterToggle
nmap ++ <plug>NERDCommenterToggle
nnoremap U <C-R> 
nmap ss :split<Return><C-w>w
nmap sv :vsplit<Return><C-w>w
inoremap jk <ESC>
noremap <silent> <expr> j (v:count == 0 ? 'gj' : 'j')
noremap <silent> <expr> k (v:count == 0 ? 'gk' : 'k')
nnoremap \ :noh<return>
nnoremap <silent> K :call CocAction('doHover')<CR>
command! -nargs=0 OR   :call     CocAction('runCommand', 'editor.action.organizeImport')
" new line in normal mode and back
autocmd CursorHoldI * :call <SID>show_hover_doc()
autocmd CursorHold * :call <SID>show_hover_doc()

nnoremap gb <C-^>
nnoremap <silent> <space>e :<C-u>CocList diagnostics<cr>
" Remap keys for gotos
nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)
nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)
nmap <leader>o <Plug>(coc-codeaction)
nmap <leader>gs :G<return>
nnoremap <leader>gd :Gdiffsplit<return>
nmap <leader>gc :Gcommit<return>
nmap <leader>gp :Gpush<return>
nmap <leader>gl :diffget //3<CR>
nmap <leader>gh :diffget //2<CR>
