-- Configure the Python host for Neovim remote plugins.
vim.g.python3_host_prog = vim.fn.stdpath("data") .. "/python3/bin/python"

-- bootstrap lazy.nvim, LazyVim and your plugins
--
require("config.lazy")
require("plugins.disabled")
require("plugins.neotree")
require("plugins.spec1")
