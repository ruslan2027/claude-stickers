# The sticker picker window on Windows: a small always-on-top panel by the
# mouse with every sticker as a picture. Reads the stickers as JSON on stdin,
# [{ "name", "description", "file" }], and writes the chosen sticker's name to
# stdout (nothing when closed). Click a sticker or press its number; Esc or the
# close button closes it. Uses only what ships with Windows (WinForms).

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 hands a JSON array on as one object; foreach unrolls it.
$items = @()
foreach ($item in (ConvertFrom-Json ([Console]::In.ReadToEnd()))) { $items += $item }
if ($items.Count -eq 0) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Stickers -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
'@
[void][Stickers.Native]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()

$scale = [System.Drawing.Graphics]::FromHwnd([System.IntPtr]::Zero).DpiX / 96
$pic = [int](88 * $scale)
$cell = [int](104 * $scale)
$columns = [Math]::Min(5, $items.Count)
$back = [System.Drawing.Color]::FromArgb(36, 37, 46)
$hover = [System.Drawing.Color]::FromArgb(58, 60, 74)
$fore = [System.Drawing.Color]::FromArgb(220, 222, 230)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Stickers'
$form.FormBorderStyle = 'FixedToolWindow'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.KeyPreview = $true
$form.BackColor = $back
$form.StartPosition = 'Manual'
$form.AutoScaleMode = 'None'

$script:choice = ''
$pick = {
  param($name)
  $script:choice = $name
  $form.Close()
}

$panel = New-Object System.Windows.Forms.FlowLayoutPanel
$panel.Dock = 'Fill'
$panel.Padding = New-Object System.Windows.Forms.Padding([int](6 * $scale))
$panel.BackColor = $back
$form.Controls.Add($panel)

$labelFont = New-Object System.Drawing.Font('Segoe UI', 9)
for ($i = 0; $i -lt $items.Count; $i++) {
  $item = $items[$i]
  $tile = New-Object System.Windows.Forms.Panel
  $tile.Size = New-Object System.Drawing.Size($cell, ($cell + [int](20 * $scale)))
  $tile.Margin = New-Object System.Windows.Forms.Padding(2)
  $tile.Cursor = 'Hand'
  $tile.Tag = $item.name

  $box = New-Object System.Windows.Forms.PictureBox
  $box.SizeMode = 'Zoom'
  $box.Size = New-Object System.Drawing.Size($pic, $pic)
  $box.Location = New-Object System.Drawing.Point([int](($cell - $pic) / 2), [int](6 * $scale))
  try { $box.Image = [System.Drawing.Image]::FromFile($item.file) } catch { }
  $box.Tag = $item.name

  $label = New-Object System.Windows.Forms.Label
  $label.Text = if ($i -lt 9) { "$($i + 1)  $($item.name)" } else { $item.name }
  $label.ForeColor = $fore
  $label.Font = $labelFont
  $label.TextAlign = 'MiddleCenter'
  $label.Size = New-Object System.Drawing.Size($cell, [int](20 * $scale))
  $label.Location = New-Object System.Drawing.Point(0, ($pic + [int](8 * $scale)))
  $label.Tag = $item.name

  $tip = New-Object System.Windows.Forms.ToolTip
  foreach ($control in @($tile, $box, $label)) {
    $control.Add_Click({ param($sender) & $pick $sender.Tag })
    $control.Add_MouseEnter({ param($sender) $(if ($sender -is [System.Windows.Forms.Panel]) { $sender } else { $sender.Parent }).BackColor = $hover })
    $control.Add_MouseLeave({ param($sender) $(if ($sender -is [System.Windows.Forms.Panel]) { $sender } else { $sender.Parent }).BackColor = $back })
    $tip.SetToolTip($control, $item.description)
  }
  $tile.Controls.Add($box)
  $tile.Controls.Add($label)
  $panel.Controls.Add($tile)
}

$rows = [Math]::Ceiling($items.Count / $columns)
# Each tile is its cell plus 2 px margins; the panel pads 6 a side. The extra
# 16 keeps the flow from wrapping a row early on rounding.
$form.ClientSize = New-Object System.Drawing.Size(
  ($columns * ($cell + 4) + [int](12 * $scale) + 16),
  ($rows * ($cell + [int](20 * $scale) + 4) + [int](12 * $scale) + 8))

# Open by the mouse, kept on the screen it is on.
$mouse = [System.Windows.Forms.Cursor]::Position
$area = [System.Windows.Forms.Screen]::FromPoint($mouse).WorkingArea
$x = [Math]::Max($area.Left, [Math]::Min($mouse.X - [int]($form.Width / 2), $area.Right - $form.Width))
$y = [Math]::Max($area.Top, [Math]::Min($mouse.Y - $form.Height - [int](12 * $scale), $area.Bottom - $form.Height))
$form.Location = New-Object System.Drawing.Point($x, $y)

$form.Add_KeyDown({
  param($sender, $e)
  if ($e.KeyCode -eq 'Escape') { $form.Close(); return }
  $n = [int]$e.KeyValue - 48
  if ($n -lt 1 -or $n -gt 9) { $n = [int]$e.KeyValue - 96 } # the number pad
  if ($n -ge 1 -and $n -le [Math]::Min(9, $items.Count)) { & $pick $items[$n - 1].name }
})
# No closing on losing focus: the console that started it can take the focus
# back right after it opens, which would shut it before anyone saw it.
$form.Add_Shown({ $form.Activate(); [void][Stickers.Native]::SetForegroundWindow($form.Handle) })

[void]$form.ShowDialog()
[Console]::Out.Write($script:choice)
