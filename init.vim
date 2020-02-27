call plug#begin()
Plug 'SirVer/ultisnips'
Plug 'mhinz/vim-startify'
Plug 'alvan/vim-closetag'
Plug 'ryanoasis/vim-devicons'
Plug 'junegunn/vim-emoji'
" tabular plugin is used to format tables
Plug 'godlygeek/tabular'
" JSON front matter highlight plugin
Plug 'elzr/vim-json'
Plug 'plasticboy/vim-markdown'
Plug 'iamcco/markdown-preview.nvim', { 'do': { -> mkdp#util#install() }}
Plug 'airblade/vim-gitgutter'
Plug 'yuezk/vim-js'
Plug 'maxmellon/vim-jsx-pretty'
Plug 'scrooloose/nerdcommenter'
Plug 'tpope/vim-fugitive'
Plug 'christoomey/vim-tmux-navigator'
Plug '/usr/local/opt/fzf'
Plug 'ryanoasis/vim-devicons'
Plug 'junegunn/fzf.vim'
Plug 'arcticicestudio/nord-vim', { 'branch': 'develop' }
Plug 'Shougo/vimproc.vim', {'do' : 'make'}
Plug 'preservim/nerdtree'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'jiangmiao/auto-pairs'
Plug 'dense-analysis/ale'
call plug#end()
set guifont=Fira\ Code:h12
set background=dark
set termguicolors
let mapleader = "\<Space>"
colorscheme nord
set number relativenumber

" FZF floating window
let $FZF_DEFAULT_COMMAND =  "find * -path '*/\.*' -prune -o -path 'node_modules/**' -prune -o -path 'target/**' -prune -o -path 'dist/**' -prune -o  -type f -print -o -type l -print 2> /dev/null"
let $FZF_DEFAULT_OPTS=' --color=dark --color=fg:15,bg:-1,hl:1,fg+:#ffffff,bg+:0,hl+:1 --color=info:0,prompt:0,pointer:12,marker:4,spinner:11,header:-1 --layout=reverse  --margin=1,4'
let g:fzf_layout = { 'window': 'call FloatingFZF()' }

function! FloatingFZF()
  let buf = nvim_create_buf(v:false, v:true)
  call setbufvar(buf, '&signcolumn', 'no')

  let height = float2nr(10)
  let width = float2nr(80)
  let horizontal = float2nr((&columns - width) / 2)
  let vertical = 1

  let opts = {
        \ 'relative': 'editor',
        \ 'row': vertical,
        \ 'col': horizontal,
        \ 'width': width,
        \ 'height': height,
        \ 'style': 'minimal'
        \ }

  call nvim_open_win(buf, v:true, opts)
endfunction

" FZF binding remapping
nnoremap <silent> <C-p> :call fzf#vim#files('.', {'options': '--prompt ""'})<CR>
nnoremap <silent> <leader>b :Buffers<CR>

" NERDTREE settings
" autocmd StdinReadPre * let s:std_in=1
" autocmd VimEnter * if argc() == 0 && !exists("s:std_in") | NERDTree | endif
autocmd BufEnter * lcd %:p:h
map <C-n> :NERDTreeToggle<CR>
let NERDTreeDirArrows = 1
vmap ++ <plug>NERDCommenterToggle
nmap ++ <plug>NERDCommenterToggle
nnoremap U <C-R> 

"Turn quit into \q
nnoremap <leader>q :q!<cr>
"Turn save quit into \z
nnoremap <leader>z :wq<cr>
"turn w into \w
nnoremap <leader>w :w<cr>

" go back into file from terminal
 tnoremap jj <C-\><C-n>

" Split window
nmap ss :split<Return><C-w>w
nmap sv :vsplit<Return><C-w>w
map  <leader>l :tabn<CR>
map <leader>h :tabp<CR>
map  <leader>n  :tabnew<CR>

" ale
let g:ale_sign_highlight_linenrs = 1
let g:ale_linters = {'python': ['flake8', 'pylint'], 'rust': ['rls'], }
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

set mouse=v
" ================ Scrolling ========================

set scrolloff=8         "Start scrolling when we're 8 lines away from margins
set sidescrolloff=15
set sidescroll=1
" Highlight matching pairs of brackets. Use the '%' character to jump between them.
set matchpairs+=<:>

inoremap jk <ESC>

" j/k will move virtual lines (lines that wrap)
noremap <silent> <expr> j (v:count == 0 ? 'gj' : 'j')
noremap <silent> <expr> k (v:count == 0 ? 'gk' : 'k')

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
let g:mkdp_auto_close = 0
" disable header folding
let g:vim_markdown_folding_disabled = 1

" do not use conceal feature, the implementation is not so good
let g:mkdp_auto_start = 1
let g:vim_markdown_conceal = 0
let g:mkdp_echo_preview_url = 1
let g:indent_guides_enable_on_vim_startup = 1
" Add spaces after comment delimiters by default
let g:NERDSpaceDelims = 1
let g:NERDCommentEmptyLines = 1
" Use compact syntax for prettified multi-line comments
let g:NERDCompactSexyComs = 1
source $HOME/.config/nvim/statusline.vim

