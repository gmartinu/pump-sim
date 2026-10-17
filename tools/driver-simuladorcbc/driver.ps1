# HTTP UI driver for the SimuladorCBC 2.7.2 (Windows), per the contract in
# tools/driver-simuladorcbc/README.md (Contract).
#
#   GET  http://127.0.0.1:7071/estado
#   POST http://127.0.0.1:7071/acao   {"tipo": "...", ...params}
#
# Acts ONLY on windows of the process named "SimuladorCBC Vr 2.7.2". HWNDs are rediscovered at boot and on
# {"tipo":"remapear"} by class + text + position, never by fixed number.
#
# Deviations from the contract, measured on the bench (17/10):
# - TCM_SETCURSEL does not switch the VCL page; tabs are switched by posting WM_LBUTTONDOWN/UP at the centre of
#   TCM_GETITEMRECT (read through a buffer in the target process). No real mouse movement.
# - VCL buttons/checkboxes/radios have no UIA patterns; everything is BM_CLICK on the HWND.
# - The 10053 MessageBox has no IDOK: its only button is IDCANCEL (2). Modals are closed via IDOK, else IDCANCEL,
#   else the VCL TButton captioned OK (TMessageForm).
# - Controls on a hidden page are switched to before acting (aba is restored afterwards), because a click on a page
#   that is not showing is not guaranteed to reach the VCL handler.
# - Retirar/Recolocar is ONE toggle button per side ("Retirar Bico" <-> "Abastecendo.."); the driver checks the caption
#   before clicking so the actions stay idempotent.
# - Captions measured in the diff r4b run (17/10): a blocked panel at rest shows "Bicos Bloqueados" (after ?C or
#   &M B) and a lifted nozzle waiting for release shows "Aguarda liberação". "Bicos Bloqueados" is at rest, so
#   retirar clicks it; "Aguarda liberação" is lifted, so recolocar clicks it.
param(
    [string]$Prefix = 'http://127.0.0.1:7071/',
    [string]$ProcessName = 'SimuladorCBC Vr 2.7.2',
    [string]$Log = (Join-Path $env:TEMP 'driver-simuladorcbc.log')
)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class U32
{
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr d, int id);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr res);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);

    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr p, IntPtr a, UIntPtr size, uint type, uint protect);
    [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr p, IntPtr a, UIntPtr size, uint type);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr p, IntPtr a, byte[] buf, UIntPtr size, out UIntPtr read);

    // LRESULTs from the 32-bit target can come back zero-extended (CB_ERR = 0xFFFFFFFF).
    static int R(IntPtr p) { return unchecked((int)p.ToInt64()); }

    public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
    public static string Cls(IntPtr h) { var s = new StringBuilder(128); GetClassName(h, s, 128); return s.ToString(); }
    public static string Text(IntPtr h)
    {
        int n = R(SendMessage(h, 0x000E, IntPtr.Zero, IntPtr.Zero));
        var s = new StringBuilder(Math.Max(n + 1, 2));
        SendMessage(h, 0x000D, (IntPtr)s.Capacity, s);
        return s.ToString();
    }
    public static int[] Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return new[] { r.L, r.T, r.R - r.L, r.B - r.T }; }

    public static List<IntPtr> TopLevel(uint pid)
    {
        var l = new List<IntPtr>();
        EnumWindows((h, x) => { if (Pid(h) == pid && IsWindowVisible(h)) l.Add(h); return true; }, IntPtr.Zero);
        return l;
    }
    public static List<IntPtr> Children(IntPtr p)
    {
        var l = new List<IntPtr>();
        EnumChildWindows(p, (h, x) => { l.Add(h); return true; }, IntPtr.Zero);
        return l;
    }

    public static bool Click(IntPtr h)
    {
        IntPtr r;
        return SendMessageTimeout(h, 0x00F5, IntPtr.Zero, IntPtr.Zero, 0x0002, 3000, out r) != IntPtr.Zero; // BM_CLICK
    }
    public static int Check(IntPtr h) { return R(SendMessage(h, 0x00F0, IntPtr.Zero, IntPtr.Zero)); } // BM_GETCHECK

    public static int TabCount(IntPtr h) { return R(SendMessage(h, 0x1304, IntPtr.Zero, IntPtr.Zero)); }
    public static int TabCur(IntPtr h) { return R(SendMessage(h, 0x130B, IntPtr.Zero, IntPtr.Zero)); }
    public static void TabClick(IntPtr h, int i)
    {
        uint pid; GetWindowThreadProcessId(h, out pid);
        IntPtr proc = OpenProcess(0x0008 | 0x0010 | 0x0020 | 0x0400, false, pid);
        if (proc == IntPtr.Zero) throw new Exception("OpenProcess falhou");
        IntPtr mem = VirtualAllocEx(proc, IntPtr.Zero, (UIntPtr)16, 0x3000, 0x04);
        int[] r;
        try
        {
            SendMessage(h, 0x130A, (IntPtr)i, mem); // TCM_GETITEMRECT
            var b = new byte[16]; UIntPtr n; ReadProcessMemory(proc, mem, b, (UIntPtr)16, out n);
            r = new[] { BitConverter.ToInt32(b, 0), BitConverter.ToInt32(b, 4), BitConverter.ToInt32(b, 8), BitConverter.ToInt32(b, 12) };
        }
        finally { VirtualFreeEx(proc, mem, UIntPtr.Zero, 0x8000); CloseHandle(proc); }
        int x = (r[0] + r[2]) / 2, y = (r[1] + r[3]) / 2;
        IntPtr lp = (IntPtr)((y << 16) | (x & 0xFFFF));
        PostMessage(h, 0x0201, (IntPtr)1, lp);
        PostMessage(h, 0x0202, IntPtr.Zero, lp);
    }

    public static string[] ComboItems(IntPtr h)
    {
        int n = R(SendMessage(h, 0x0146, IntPtr.Zero, IntPtr.Zero)); // CB_GETCOUNT
        if (n <= 0) return new string[0];
        var items = new string[n];
        for (int i = 0; i < n; i++)
        {
            int len = R(SendMessage(h, 0x0149, (IntPtr)i, IntPtr.Zero)); // CB_GETLBTEXTLEN
            var s = new StringBuilder(Math.Max(len + 1, 2));
            SendMessage(h, 0x0148, (IntPtr)i, s); // CB_GETLBTEXT (marshalled: local buffer)
            items[i] = s.ToString();
        }
        return items;
    }
    /// CB_SETCURSEL + WM_COMMAND(CBN_SELCHANGE) to the parent, which is what VCL turns into OnChange.
    public static void ComboSelect(IntPtr h, int index)
    {
        SendMessage(h, 0x014E, (IntPtr)index, IntPtr.Zero); // CB_SETCURSEL
        int id = GetDlgCtrlID(h);
        IntPtr wp = (IntPtr)(((1 & 0xFFFF) << 16) | (id & 0xFFFF)); // MAKEWPARAM(id, CBN_SELCHANGE)
        SendMessage(GetParent(h), 0x0111, wp, h);
    }

    public static List<IntPtr> Dialogs(uint pid)
    {
        var l = new List<IntPtr>();
        foreach (var h in TopLevel(pid)) { var c = Cls(h); if (c == "#32770" || c == "TMessageForm") l.Add(h); }
        return l;
    }
    public static IntPtr DialogButton(IntPtr dlg, out string which)
    {
        var ok = GetDlgItem(dlg, 1); if (ok != IntPtr.Zero) { which = "IDOK"; return ok; }
        var ca = GetDlgItem(dlg, 2); if (ca != IntPtr.Zero) { which = "IDCANCEL"; return ca; }
        IntPtr first = IntPtr.Zero;
        foreach (var c in Children(dlg))
        {
            var cls = Cls(c); if (cls != "TButton" && cls != "Button") continue;
            if (first == IntPtr.Zero) first = c;
            if (Text(c).Replace("&", "") == "OK") { which = "TButton OK"; return c; }
        }
        which = first != IntPtr.Zero ? "TButton (1o)" : "nenhum";
        return first;
    }
}
"@

function Write-DriverLog([string]$msg) {
    [IO.File]::AppendAllText($Log, "$((Get-Date).ToString('o')) $msg`r`n", [Text.UTF8Encoding]::new($false))
}

$script:M = $null   # control map

# Panel button captions. At rest: "Retirar Bico", "Retira Bico" (without the "r": what a freshly created panel
# shows at start or right after "Carregar configuração padrão", until the next tick rewrites it), "Concluindo.."
# (already hung up) and "Bicos Bloqueados".
# Lifted: "Abastecendo..", "Aguarda liberação" and the contract's "Recolocar Bico". Non-ASCII chars are built
# from code points so the file means the same under PowerShell 5.1 whatever codepage reads it.
$script:LEGENDA_AGUARDA = 'Aguarda libera' + [char]0x00E7 + [char]0x00E3 + 'o'
$script:LEGENDAS_REPOUSO = @('Retirar Bico', 'Retira Bico', 'Concluindo..', 'Bicos Bloqueados')
$script:LEGENDAS_BOTAO = @('Retirar Bico', 'Retira Bico', 'Abastecendo..', 'Recolocar Bico', 'Concluindo..', 'Bicos Bloqueados', $script:LEGENDA_AGUARDA)

function Get-SimPid {
    $p = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
    if ($p.Count -ne 1) { throw "esperava 1 processo '$ProcessName', achei $($p.Count)" }
    [uint32]$p[0].Id
}

function Close-Modals {
    $pid_ = Get-SimPid
    $fechados = @()
    for ($i = 0; $i -lt 10; $i++) {
        $dlg = [U32]::Dialogs($pid_) | Select-Object -First 1
        if (-not $dlg) { break }
        if ([U32]::Pid($dlg) -ne $pid_) { break }
        $cls = [U32]::Cls($dlg); $titulo = [U32]::Text($dlg)
        $texto = ([U32]::Children($dlg) | Where-Object { [U32]::Cls($_) -in 'Static', 'TLabel' } | ForEach-Object { [U32]::Text($_) } | Where-Object { $_ }) -join ' | '
        $which = ''; $btn = [U32]::DialogButton($dlg, [ref]$which)
        if ($btn -eq [IntPtr]::Zero) { $fechados += [ordered]@{ ts = (Get-Date).ToString('o'); cls = $cls; titulo = $titulo; texto = $texto; acao = 'sem botão' }; break }
        [void][U32]::Click($btn); Start-Sleep -Milliseconds 200
        $fechou = -not ([U32]::IsWindow($dlg) -and [U32]::IsWindowVisible($dlg))
        $fechados += [ordered]@{ ts = (Get-Date).ToString('o'); cls = $cls; titulo = $titulo; texto = $texto; acao = "BM_CLICK $which; $(if ($fechou) { 'fechado' } else { 'ainda aberto' })" }
        if (-not $fechou) { break }
    }
    foreach ($f in $fechados) { Write-DriverLog "modal: $($f | ConvertTo-Json -Compress)" }
    , $fechados
}

function Find-Map {
    $pid_ = Get-SimPid
    $form = [U32]::TopLevel($pid_) | Where-Object { [U32]::Cls($_) -eq 'TForm1' } | Select-Object -First 1
    if (-not $form) { throw 'TForm1 do simulador não encontrado' }
    $all = foreach ($h in [U32]::Children($form)) {
        [pscustomobject]@{ h = $h; cls = [U32]::Cls($h); text = [U32]::Text($h); r = [U32]::Rect($h); parent = [U32]::GetParent($h) }
    }
    $one = { param($c, $t) $all | Where-Object { $_.cls -eq $c -and $_.text -eq $t } | Select-Object -First 1 }

    $pc = $all | Where-Object { $_.cls -eq 'TPageControl' } | Select-Object -First 1
    $tc = $all | Where-Object { $_.cls -eq 'TTabControl' } | Select-Object -First 1
    # Window order is not tab order: click each tab once and see which TTabSheet becomes visible.
    $sheetWins = @($all | Where-Object { $_.cls -eq 'TTabSheet' -and $_.parent -eq $pc.h })
    $origTab = [U32]::TabCur($pc.h)
    $sheets = @()
    for ($t = 0; $t -lt [U32]::TabCount($pc.h); $t++) {
        [U32]::TabClick($pc.h, $t)
        for ($k = 0; $k -lt 20 -and [U32]::TabCur($pc.h) -ne $t; $k++) { Start-Sleep -Milliseconds 50 }
        Start-Sleep -Milliseconds 250
        $vis = $sheetWins | Where-Object { [U32]::IsWindowVisible($_.h) } | Select-Object -First 1
        $sheets += $(if ($vis) { $vis.text } else { "aba$t" })
    }
    if ($origTab -ge 0) { [U32]::TabClick($pc.h, $origTab); Start-Sleep -Milliseconds 300 }

    # Nozzle panels: each has a toggle TButton and two TRadioButton siblings; left/right by screen x.
    $botoes = @($all | Where-Object { $_.cls -eq 'TButton' -and $_.text -in $script:LEGENDAS_BOTAO } | Sort-Object { $_.r[0] })
    if ($botoes.Count -ne 2) { throw "esperava 2 botões de bico, achei $($botoes.Count)" }
    $lado = @{}
    foreach ($pair in @(@('esquerdo', $botoes[0]), @('direito', $botoes[1]))) {
        $b = $pair[1]
        $radios = @($all | Where-Object { $_.cls -eq 'TRadioButton' -and $_.parent -eq $b.parent } | Sort-Object { $_.r[0] })
        $lado[$pair[0]] = @{ botao = $b.h; radio_pos0 = $radios[0].h; radio_alt = $radios[1].h }
    }

    # DIP group: the parent that holds exactly 6 TCheckBox; DIP n by ascending x.
    $dipGroup = $all | Where-Object { $_.cls -eq 'TCheckBox' } | Group-Object { $_.parent } | Where-Object { $_.Count -eq 6 } | Select-Object -First 1
    if (-not $dipGroup) { throw 'grupo de DIPs (6 TCheckBox) não encontrado' }
    $dips = @{}; $i = 1
    foreach ($c in ($dipGroup.Group | Sort-Object { $_.r[0] })) { $dips["$i"] = $c.h; $i++ }

    $vel = @{ Lento = (& $one 'TRadioButton' 'Lento').h; Normal = (& $one 'TRadioButton' 'Normal').h; Rapido = (& $one 'TRadioButton' 'Rápido').h }
    $porta = @{ '2001' = (& $one 'TRadioButton' '2001').h; '1771' = (& $one 'TRadioButton' '1771').h; '7002' = (& $one 'TRadioButton' '7002').h }

    $combos = foreach ($c in ($all | Where-Object { $_.cls -eq 'TComboBox' })) { [pscustomobject]@{ h = $c.h; items = [U32]::ComboItems($c.h); y = $c.r[1] } }
    $modelo = $combos | Where-Object { $_.items -contains 'Horustech' } | Select-Object -First 1
    $liga = @($combos | Where-Object { ($_.items -join ';') -eq 'Ligado;Desligado' } | Sort-Object y)
    if (-not $modelo -or $liga.Count -lt 1) { throw 'combos de Modelo/Automação não encontrados' }

    $script:M = @{
        pid = $pid_; form = $form; pc = $pc.h; tc = $tc.h; sheets = $sheets
        lado = $lado; dips = $dips; vel = $vel; porta = $porta
        modelo = $modelo.h; automacao = $liga[0].h; rede_ac = $(if ($liga.Count -gt 1) { $liga[1].h } else { [IntPtr]::Zero })
        config_padrao = (& $one 'TButton' 'Carregar configuração padrão').h
        pagina = @{ bico = 'Canais CBC'; dip = 'Configuração CBC'; velocidade = 'Configuração CBC'; modelo = 'Configuração CBC'; automacao = 'Configuração CBC'; config_padrao = 'Configuração CBC'; porta = 'Comunicação' }
    }
    Write-DriverLog "remapeado: pid=$pid_ sheets=$($sheets -join ',') botoes=$($botoes.h -join ',') dips=$(($dips.Keys | Sort-Object | ForEach-Object { "$_=$($dips[$_])" }) -join ',')"
}

function Assert-Map {
    if (-not $script:M -or -not [U32]::IsWindow($script:M.form) -or [U32]::Pid($script:M.form) -ne (Get-SimPid)) { Find-Map }
}

function Select-Aba([string]$nome) {
    $i = [array]::IndexOf($script:M.sheets, $nome)
    if ($i -lt 0) { throw "aba desconhecida: $nome (conhecidas: $($script:M.sheets -join ', '))" }
    if ([U32]::TabCur($script:M.pc) -ne $i) {
        [U32]::TabClick($script:M.pc, $i)
        for ($k = 0; $k -lt 20 -and [U32]::TabCur($script:M.pc) -ne $i; $k++) { Start-Sleep -Milliseconds 50 }
        Start-Sleep -Milliseconds 300
    }
    if ([U32]::TabCur($script:M.pc) -ne $i) { throw "não consegui selecionar a aba $nome" }
}

# Runs $body with page $nome showing, then puts the previous page back.
function Invoke-OnPage([string]$nome, [scriptblock]$body) {
    $antes = [U32]::TabCur($script:M.pc)
    Select-Aba $nome
    try { & $body } finally { if ($antes -ge 0 -and [U32]::TabCur($script:M.pc) -ne $antes) { Select-Aba $script:M.sheets[$antes] } }
}

function Get-Estado {
    Assert-Map
    $m = $script:M
    $dips = [ordered]@{}; foreach ($k in '1', '2', '3', '4', '5', '6') { $dips[$k] = ([U32]::Check($m.dips[$k]) -eq 1) }
    $vel = ($m.vel.Keys | Where-Object { [U32]::Check($m.vel[$_]) -eq 1 } | Select-Object -First 1)
    $porta = ($m.porta.Keys | Where-Object { [U32]::Check($m.porta[$_]) -eq 1 } | Select-Object -First 1)
    $bico = { param($l) $r0 = $m.lado[$l].radio_pos0; $r1 = $m.lado[$l].radio_alt; if ([U32]::Check($r1) -eq 1) { [U32]::Text($r1) } else { [U32]::Text($r0) } }
    [ordered]@{
        pid = [int]$m.pid
        aba = $m.sheets[[U32]::TabCur($m.pc)]
        canal = [U32]::TabCur($m.tc) + 1
        dips = $dips
        velocidade = $vel
        modelo = [U32]::Text($m.modelo)
        automacao = [U32]::Text($m.automacao)
        rede_ac = $(if ($m.rede_ac -ne [IntPtr]::Zero) { [U32]::Text($m.rede_ac) } else { $null })
        porta = $(if ($porta) { [int]$porta } else { $null })
        botoes = [ordered]@{ esquerdo = [U32]::Text($m.lado.esquerdo.botao); direito = [U32]::Text($m.lado.direito.botao) }
        bicos = [ordered]@{ esquerdo = (& $bico 'esquerdo'); direito = (& $bico 'direito') }
    }
}

function Get-Lado($a) { $l = if ($a.lado) { [string]$a.lado } else { 'esquerdo' }; if ($l -notin 'esquerdo', 'direito') { throw "lado inválido: $l" }; $l }

function Set-Toggle([IntPtr]$h, [bool]$want) { if (([U32]::Check($h) -eq 1) -ne $want) { [void][U32]::Click($h); Start-Sleep -Milliseconds 200 } ; ([U32]::Check($h) -eq 1) -eq $want }

# Caption lifecycle measured on the bench: "Retirar Bico" -(click, ~0.5-1 s)-> "Abastecendo.." -(click)->
# "Concluindo.." -> "Retirar Bico". The caption lags the click, so wait for the expected state instead of
# reading it right away. "Concluindo.." already counts as returned (a second click there would lift it again).
# "Bicos Bloqueados" is a blocked panel at rest (diff r4b: treating it as lifted skipped the click in DIFF-18 and
# left the nozzle lifted for DIFF-19/20); "Aguarda liberação" is lifted and waiting for release.
function Test-Retirado([string]$caption) { $caption -notin $script:LEGENDAS_REPOUSO }

function Invoke-Bico([string]$lado, [bool]$retirar) {
    $b = $script:M.lado[$lado].botao
    Invoke-OnPage $script:M.pagina.bico {
        $antes = [U32]::Text($b)
        if ((Test-Retirado $antes) -ne $retirar) {
            if ($antes -eq 'Concluindo..') {
                # Wait for the previous cycle to finish before lifting again.
                for ($k = 0; $k -lt 40 -and [U32]::Text($b) -eq 'Concluindo..'; $k++) { Start-Sleep -Milliseconds 100 }
            }
            [void][U32]::Click($b)
            for ($k = 0; $k -lt 40 -and (Test-Retirado ([U32]::Text($b))) -ne $retirar; $k++) { Start-Sleep -Milliseconds 100 }
        }
        $depois = [U32]::Text($b)
        if ((Test-Retirado $depois) -ne $retirar) { throw "botão do $lado não chegou ao estado esperado em 4 s: '$antes' -> '$depois'" }
        $script:ultimo = "botão $lado '$antes' -> '$depois'"
    }
}

function Invoke-Acao($a) {
    Assert-Map
    $m = $script:M
    $script:ultimo = $null
    switch ([string]$a.tipo) {
        'fechar_modais' { }
        'remapear' { Find-Map }
        'aba' { Select-Aba ([string]$a.nome) }
        'canal' {
            $n = [int]$a.n; if ($n -lt 1 -or $n -gt 8) { throw "canal fora de 1..8: $n" }
            Invoke-OnPage $m.pagina.bico { if ([U32]::TabCur($m.tc) -ne ($n - 1)) { [U32]::TabClick($m.tc, $n - 1); Start-Sleep -Milliseconds 400 } }
            if ([U32]::TabCur($m.tc) -ne ($n - 1)) { throw "não consegui selecionar o canal $n" }
        }
        'bico_radio' {
            $l = Get-Lado $a; $h = if ($a.alt) { $m.lado[$l].radio_alt } else { $m.lado[$l].radio_pos0 }
            Invoke-OnPage $m.pagina.bico { if ([U32]::Check($h) -ne 1) { [void][U32]::Click($h); Start-Sleep -Milliseconds 200 } }
            if ([U32]::Check($h) -ne 1) { throw 'radio do bico não marcou' }
        }
        'retirar' { Invoke-Bico (Get-Lado $a) $true }
        'recolocar' { Invoke-Bico (Get-Lado $a) $false }
        'abastecer' {
            $l = Get-Lado $a; $s = if ($a.segundos) { [double]$a.segundos } else { 3 }
            Invoke-Bico $l $true; Start-Sleep -Milliseconds ([int]($s * 1000)); Invoke-Bico $l $false
        }
        'dip' {
            $n = [string][int]$a.n; if ($n -notin '1', '2', '3', '4') { throw "dip fora de 1..4: $n" }
            $ok = $false; Invoke-OnPage $m.pagina.dip { $script:okDip = Set-Toggle $m.dips[$n] ([bool]$a.ligado) }
            if (-not $script:okDip) { throw "DIP$n não ficou em $($a.ligado)" }
        }
        'velocidade' {
            $v = ([string]$a.valor) -replace 'á', 'a'; if (-not $v) { $v = [string]$a.velocidade }
            if (-not $m.vel.ContainsKey($v)) { throw "velocidade inválida: $v" }
            Invoke-OnPage $m.pagina.velocidade { if ([U32]::Check($m.vel[$v]) -ne 1) { [void][U32]::Click($m.vel[$v]); Start-Sleep -Milliseconds 200 } }
            if ([U32]::Check($m.vel[$v]) -ne 1) { throw "velocidade não ficou em $v" }
        }
        { $_ -in 'modelo', 'automacao' } {
            $h = $m[[string]$a.tipo]; $v = if ($a.valor) { [string]$a.valor } else { [string]$a.($a.tipo) }
            $items = [U32]::ComboItems($h); $i = [array]::IndexOf($items, $v)
            if ($i -lt 0) { throw "$($a.tipo) inválido: $v (opções: $($items -join ', '))" }
            Invoke-OnPage $m.pagina[[string]$a.tipo] { if ([U32]::Text($h) -ne $v) { [U32]::ComboSelect($h, $i); Start-Sleep -Milliseconds 300 } }
            if ([U32]::Text($h) -ne $v) { throw "$($a.tipo) não ficou em $v (lido: $([U32]::Text($h)))" }
        }
        'porta' {
            $p = [string][int]$a.valor; if (-not $p -or $p -eq '0') { $p = [string][int]$a.porta }
            if (-not $m.porta.ContainsKey($p)) { throw "porta inválida: $p" }
            Invoke-OnPage $m.pagina.porta { if ([U32]::Check($m.porta[$p]) -ne 1) { [void][U32]::Click($m.porta[$p]); Start-Sleep -Milliseconds 300 } }
            if ([U32]::Check($m.porta[$p]) -ne 1) { throw "porta não ficou em $p" }
        }
        'config_padrao' { Invoke-OnPage $m.pagina.config_padrao { [void][U32]::Click($m.config_padrao); Start-Sleep -Milliseconds 500 } }
        default { throw "tipo desconhecido: $($a.tipo)" }
    }
}

function Send-Json($ctx, [int]$status, $obj) {
    $json = $obj | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $ctx.Response.StatusCode = $status
    $ctx.Response.ContentType = 'application/json; charset=utf-8'
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)
$listener.Start()
Write-DriverLog "driver no ar em $Prefix (pid $PID)"
try { Find-Map } catch { Write-DriverLog "mapa inicial falhou: $($_.Exception.Message)" }

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    try {
        # Loopback only, as the contract says; refuse anything else even if a prefix ever widens.
        if (-not [Net.IPAddress]::IsLoopback($req.RemoteEndPoint.Address)) { Send-Json $ctx 403 @{ ok = $false; erro = 'só loopback' }; continue }
        $path = $req.Url.AbsolutePath.TrimEnd('/')
        if ($req.HttpMethod -eq 'GET' -and $path -eq '/estado') {
            $fech = Close-Modals
            Send-Json $ctx 200 ([ordered]@{ ok = $true; estado = (Get-Estado); modais_fechados = $fech })
        } elseif ($req.HttpMethod -eq 'POST' -and $path -eq '/acao') {
            if ($req.ContentType -notlike 'application/json*') { Send-Json $ctx 415 @{ ok = $false; erro = 'content-type deve ser application/json' }; continue }
            $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
            $a = $body | ConvertFrom-Json
            Write-DriverLog "acao: $body"
            $fech = Close-Modals
            Invoke-Acao $a
            $fech2 = Close-Modals
            Send-Json $ctx 200 ([ordered]@{ ok = $true; detalhe = $script:ultimo; estado = (Get-Estado); modais_fechados = @($fech) + @($fech2) })
        } else {
            Send-Json $ctx 404 @{ ok = $false; erro = "rota desconhecida: $($req.HttpMethod) $path" }
        }
    } catch {
        Write-DriverLog "erro: $($_.Exception.Message)"
        try { Send-Json $ctx 400 @{ ok = $false; erro = $_.Exception.Message } } catch { }
    }
}
