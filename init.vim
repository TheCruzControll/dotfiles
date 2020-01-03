" == VIM PLUG ================================
call plug#begin('~/.vim/plugged')
Plug 'mxw/vim-jsx'
Plug 'pangloss/vim-javascript'
Plug 'arcticicestudio/nord-vim'
Plug 'preservim/nerdtree'
Plug '~/.fzf'
Plug 'prettier/vim-prettier', { 'do': 'yarn install' }
call plug#end()
let NERDTreeShowHidden=1
autocmd vimenter * NERDTree
autocmd StdinReadPre * let s:std_in=1
autocmd VimEnter * if argc() == 0 && !exists("s:std_in") | NERDTree | endif
colorscheme nord
