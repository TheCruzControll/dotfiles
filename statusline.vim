" ====================================================================
" Make sure to:
" 1. source this file somewhere at the bottom of your config.
" 2. disable any statusline plugins, as they will override this.
" ====================================================================
" Do not show mode under the statusline since the statusline itself changes
" color depending on mode
set noshowmode

set laststatus=2
" ~~~~ Statusline configuration ~~~~
" ':help statusline' is your friend!
function! RedrawModeColors(mode) " {{{
  " Normal mode
  if a:mode == 'n'
    hi MyStatuslineAccent ctermfg=8 cterm=NONE ctermbg=NONE guifg=#56687e guibg=NONE
    hi MyStatuslineFilename ctermfg=4 cterm=none ctermbg=8 guifg=#92b6f4 guibg=#4e5d6f
    hi MyStatuslineAccentBody  ctermbg=8 cterm=NONE ctermfg=4 guifg=#92b6f4 guibg=#56687e
  " Insert mode
  elseif a:mode == 'i'
    hi MyStatuslineAccent ctermfg=8 cterm=NONE ctermbg=NONE guifg=#56687e guibg=NONE
    hi MyStatuslineFilename ctermfg=1 cterm=none ctermbg=8 guifg=#f48fb1 guibg=#4e5d6f
    hi MyStatuslineAccentBody ctermbg=8 cterm=NONE ctermfg=1 guifg=#f48fb1 guibg=#56687e
  " Replace mode
  elseif a:mode == 'R'
    hi MyStatuslineAccentgg ctermfg=8 cterm=NONE ctermbg=NONE guifg=#56687e guibg=NONE
    hi MyStatuslineFilename ctermfg=3 cterm=none ctermbg=8 guifg=#f1fa8c guibg=#4e5d6f
    hi MyStatuslineAccentBody ctermbg=8 cterm=NONE ctermfg=3 guifg=#f1fa8c guibg=#56687e
  " Visual mode
  elseif a:mode == 'v' || a:mode == 'V' || a:mode == '^V'
    hi MyStatuslineAccent ctermfg=8 cterm=NONE ctermbg=NONE guifg=#56687e guibg=NONE
    hi MyStatuslineFilename ctermfg=5 cterm=none ctermbg=8 guifg=#bd9955 guibg=#4e5d6f
    hi MyStatuslineAccentBody ctermbg=8 cterm=NONE ctermfg=5 guifg=#bd9955 guibg=#56687e
  " Command mode
  elseif a:mode == 'c'
    hi MyStatuslineAccent ctermfg=8 cterm=NONE ctermbg=NONE guifg=#56687e guibg=NONE
    hi MyStatuslineFilename ctermfg=6 cterm=none ctermbg=8 guifg=#87dfeb guibg=#4e5d6f
    hi MyStatuslineAccentBody ctermbg=8 cterm=NONE ctermfg=6 guifg=#87dfeb guibg=#56687e
  " Terminal mode
  elseif a:mode == 't'
    hi MyStatuslineAccent ctermfg=8 cterm=NONE ctermbg=NONE guifg=#56687e guibg=NONE
    hi MyStatuslineFilename ctermfg=1 cterm=none ctermbg=8 guifg=#f48fb1 guibg=#4e5d6f
    hi MyStatuslineAccentBody ctermbg=8 cterm=NONE ctermfg=1 guifg=#f48fb1 guibg=#56687e
  endif
  " Return empty string so as not to display anything in the statusline
  return ''
endfunction
" }}}
function! SetModifiedSymbol(modified) " {{{
    if a:modified == 1
        hi MyStatuslineModifiedBody ctermbg=8 cterm=bold ctermfg=1 guifg=#f48fb1 guibg=#4e5d6f
    else
        hi MyStatuslineModifiedBody ctermbg=8 cterm=bold ctermfg=2 guifg=#4e5d6f guibg=#4e5d6f
    endif
    return '●'
endfunction
" }}}
function! SetFiletype(filetype) " {{{
  if a:filetype == ''
      return '-'
  else
      return a:filetype
  endif
endfunction

function! SetModeTerm(mode) " {{{
  if a:mode == 'n'
    return 'Normal'
  " Insert mode
  elseif a:mode == 'i'
    return 'Insert'
  " Replace mode
  elseif a:mode == 'R'
    return 'Replace'
  " Visual mode
  elseif a:mode == 'v' || a:mode == 'V' || a:mode == '^V'
    
    return 'Visual'
  " Command mode
  elseif a:mode == 'c'
    return 'Command'
  " Terminal mode
  elseif a:mode == 't'
    return 'Terminal'
  endif

endfunction
"
" }}}

" Statusbar items
" ====================================================================

" This will not be displayed, but the function RedrawModeColors will be
" called every time the mode changes, thus updating the colors used for the
" components.
set statusline=%{RedrawModeColors(mode())}
" Left side items
" =======================
set statusline+=%#MyStatuslineAccent#
set statusline+=%#MyStatuslineAccentBody#
set statusline+=\ 
set statusline+=%#MyStatuslineAccentBody#%{SetModeTerm(mode())}
" Filename
set statusline+=%#MyStatuslineFilename#\ \ %.30f
set statusline+=%#MyStatuslineSeparator#\ 
" Modified status
set statusline+=%#MyStatuslineModified#
set statusline+=%#MyStatuslineModifiedBody#%{SetModifiedSymbol(&modified)}
set statusline+=%#MyStatuslineModified#
" Right side items
" =======================
set statusline+=%=
set statusline+=%#MyStatuslineLineCol#
set statusline+=%#MyStatuslineLineColBody#%{fugitive#statusline()}
set statusline+=%#MyStatuslineLineCol#

" Line and Column
set statusline+=%#MyStatuslineLineCol#
set statusline+=%#MyStatuslineLineColBody#%2l
set statusline+=\/%#MyStatuslineLineColBody#%1c
set statusline+=%#MyStatuslineLineCol#
" Padding
set statusline+=\ 
" Current scroll percentage and total lines of the file
set statusline+=%#MyStatuslinePercentage#
set statusline+=%#MyStatuslinePercentageBody#%P
set statusline+=\/\%#MyStatuslinePercentageBody#%L
set statusline+=%#MyStatuslinePercentage#
" Padding
set statusline+=\ 
" Filetype
set statusline+=%#MyStatuslineFiletype#
set statusline+=%#MyStatuslineFiletypeBody#%{SetFiletype(&filetype)}
set statusline+=%#MyStatuslineFiletype#

" Setup the colors
hi StatusLine                   guifg=#bd9955     ctermfg=12       guibg=NONE      ctermbg=NONE        cterm=bold
hi StatusLineNC                 guifg=#56687e     ctermfg=8       guibg=NONE      ctermbg=NONE           cterm=NONE

hi MyGitStatus         guifg=#4e5d6f  guibg=NONE ctermbg=NONE cterm=NONE ctermfg=8
hi MyGitStatusBody guifg=#bd9955 guibg=#4e5d6f ctermfg=5 cterm=italic ctermbg=8

hi MyStatuslineSeparator        guifg=#4e5d6f     ctermfg=8       guibg=NONE      ctermbg=NONE        cterm=NONE

hi MyStatuslineModified         guifg=#4e5d6f     ctermfg=8       guibg=NONE      ctermbg=NONE        cterm=NONE

hi MyStatuslineFiletype         guifg=#4e5d6f  guibg=NONE ctermbg=NONE cterm=NONE ctermfg=8
hi MyStatuslineFiletypeBody guifg=#bd9955 guibg=#4e5d6f ctermfg=5 cterm=italic ctermbg=8

hi MyStatuslinePercentage guifg=#4e5d6f guibg=NONE ctermfg=8 cterm=NONE ctermbg=NONE
hi MyStatuslinePercentageBody guifg=#87dfeb guibg=#4e5d6f ctermbg=8 cterm=none ctermfg=6

hi MyStatuslineLineCol guifg=#4e5d6f guibg=NONE ctermfg=8 cterm=NONE ctermbg=NONE
hi MyStatuslineLineColBody guifg=#a1efd3 guibg=#4e5d6f ctermbg=8 cterm=none ctermfg=2c
