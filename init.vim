call plug#begin()
Plug 'airblade/vim-gitgutter'
Plug 'sheerun/vim-polyglot'
Plug 'scrooloose/nerdcommenter'
Plug 'christoomey/vim-tmux-navigator'
Plug '/usr/local/opt/fzf'
Plug 'ryanoasis/vim-devicons'
Plug 'junegunn/fzf.vim'
Plug 'arcticicestudio/nord-vim'
Plug 'preservim/nerdtree'
Plug 'tpope/vim-fugitive'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'jiangmiao/auto-pairs'
Plug 'dense-analysis/ale'
call plug#end()
set guifont=Fira\ Code:h12
set termguicolors
set background=dark
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
autocmd StdinReadPre * let s:std_in=1
autocmd VimEnter * if argc() == 0 && !exists("s:std_in") | NERDTree | endif
autocmd BufEnter * lcd %:p:h
map <C-n> :NERDTreeToggle<CR>
let NERDTreeDirArrows = 1
vmap ++ <plug>NERDCommenterToggle
nmap ++ <plug>NERDCommenterToggle
nnoremap U <C-R> # redo

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

let g:ale_fix_on_save = 1
" ale
let g:ale_sign_highlight_linenrs = 1
let g:ale_linters = {'python': ['flake8', 'pylint'], 'rust': ['rls']}
let g:ale_sign_error = ""
let g:ale_sign_warning = ""
let g:airline#extensions#ale#enabled = 1
let g:formatdef_eslint = '"eslint-formatter"'
let g:formatters_javascript = ['prettier', 'eslint']
let g:ale_fix_on_save = 1
let g:ale_fixers = {'javascript': ['eslint'], 'json': ['jq'], 'html': ['prettier'], 'scss': ['stylelint'], 'less': ['stylelint'], 'css': ['stylelint'], 'python': ['black', 'yapf'], 'rust': ['rustfmt']}
let g:ale_set_highlights = 0
let g:ale_lint_on_text_changed = 'always'
let g:ale_python_flake8_executable = 'python3'
let g:ale_sign_column_always = 1
let g:ale_echo_cursor = 1

set mouse=v

" Always show at least one line above/below the cursor.
set scrolloff=2

" Always show at least one line left/right of the cursor.
set sidescrolloff=5

" Highlight matching pairs of brackets. Use the '%' character to jump between them.
set matchpairs+=<:>


source $HOME/.config/nvim/statusline.vim

