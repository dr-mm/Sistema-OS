const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const archiver = require('archiver');

const app = express();
const PORT = 3000;

// Configuração de pastas
const pastaUploads = path.join(__dirname, 'uploads');
if (!fs.existsSync(pastaUploads)) {
    fs.mkdirSync(pastaUploads, { recursive: true });
}

// Configurações do servidor
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(pastaUploads));

// Conexão com o SQLite
const db = new sqlite3.Database('./banco.sqlite', (err) => {
    if (err) console.error('Erro ao conectar no banco:', err.message);
    else {
        console.log('Motor conectado ao SQLite!');
        garantirEstrutura();
    }
});

// Garante colunas necessárias
function garantirEstrutura() {
    db.serialize(() => {
        db.run("ALTER TABLE clientes ADD COLUMN ativo INTEGER DEFAULT 1", () => {});
        db.run("ALTER TABLE catalogo ADD COLUMN estoque_atual INTEGER DEFAULT 0", () => {});
        db.run("ALTER TABLE ordens_servico ADD COLUMN cliente_nome_salvo TEXT", () => {});
        db.run("ALTER TABLE ordens_servico ADD COLUMN cliente_telefone_salvo TEXT", () => {});
        db.run("ALTER TABLE ordens_servico ADD COLUMN cliente_endereco_salvo TEXT", () => {});
        db.run("ALTER TABLE ordens_servico ADD COLUMN dispositivo_tipo TEXT", () => {});
        db.run("ALTER TABLE ordens_servico ADD COLUMN dispositivo_modelo TEXT", () => {});
        db.run("ALTER TABLE ordens_servico ADD COLUMN dispositivo_serial TEXT", () => {});
        db.run("ALTER TABLE os_itens ADD COLUMN item_nome_salvo TEXT", () => {});
        db.run("ALTER TABLE os_itens ADD COLUMN item_tipo_salvo TEXT", () => {});
        db.run("ALTER TABLE os_itens ADD COLUMN dias_garantia_salvo INTEGER DEFAULT 0", () => {});
    });
}

// Configuração do Multer (fotos)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, pastaUploads),
    filename: (req, file, cb) => {
        const extensao = path.extname(file.originalname);
        const nomeUnico = `${Date.now()}-${Math.round(Math.random() * 1E9)}${extensao}`;
        cb(null, nomeUnico);
    }
});
const upload = multer({ storage });

// ==========================================
// 1. ROTAS DO CATÁLOGO E ESTOQUE
// ==========================================
app.get('/api/catalogo', (req, res) => {
    db.all('SELECT * FROM catalogo ORDER BY nome ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.post('/api/catalogo', (req, res) => {
    const { nome, tipo, preco, dias_garantia, estoque_atual } = req.body;
    const sql = `INSERT INTO catalogo (nome, tipo, preco, dias_garantia, estoque_atual) VALUES (?, ?, ?, ?, ?)`;
    db.run(sql, [
        nome, 
        tipo, 
        preco, 
        dias_garantia || 0, 
        tipo === 'Peça' ? (parseInt(estoque_atual) || 0) : 0
    ], function (err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ id: this.lastID, mensagem: 'Item adicionado com sucesso!' });
    });
});

// Atualizar item do Catálogo com sincronização inteligente de preços
app.put('/api/catalogo/:id', (req, res) => {
    const { nome, tipo, preco, dias_garantia, estoque_atual } = req.body;
    const catId = req.params.id;

    const sql = `UPDATE catalogo SET nome = ?, tipo = ?, preco = ?, dias_garantia = ?, estoque_atual = ? WHERE id = ?`;
    db.run(sql, [
        nome, 
        tipo, 
        preco, 
        dias_garantia || 0, 
        tipo === 'Peça' ? (parseInt(estoque_atual) || 0) : 0, 
        catId
    ], function (err) {
        if (err) return res.status(500).json({ erro: err.message });

        // 1. Sincroniza novos preços, nomes e garantias APENAS em OS com status 'Orçamento'
        const sqlSyncOrcamento = `
            UPDATE os_itens 
            SET valor_unitario = ?, 
                item_nome_salvo = ?, 
                item_tipo_salvo = ?, 
                dias_garantia_salvo = ? 
            WHERE catalogo_id = ? 
              AND os_id IN (SELECT id FROM ordens_servico WHERE status = 'Orçamento')
        `;
        db.run(sqlSyncOrcamento, [preco, nome, tipo, dias_garantia || 0, catId], (errOrc) => {
            if (errOrc) console.error('Erro ao sincronizar orçamentos:', errOrc.message);

            // 2. Para OS 'Em Andamento', atualiza nome/garantia sem alterar o preço acordado
            const sqlSyncAndamento = `
                UPDATE os_itens 
                SET item_nome_salvo = ?, 
                    item_tipo_salvo = ?, 
                    dias_garantia_salvo = ? 
                WHERE catalogo_id = ? 
                  AND os_id IN (SELECT id FROM ordens_servico WHERE status = 'Em Andamento')
            `;
            db.run(sqlSyncAndamento, [nome, tipo, dias_garantia || 0, catId], (errAnd) => {
                if (errAnd) console.error('Erro ao sincronizar OS em andamento:', errAnd.message);
                res.json({ mensagem: 'Catálogo atualizado e orçamentos sincronizados com sucesso!' });
            });
        });
    });
});

app.delete('/api/catalogo/:id', (req, res) => {
    db.run(`DELETE FROM catalogo WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ mensagem: 'Item removido!' });
    });
});

app.get('/api/estoque', (req, res) => {
    db.all("SELECT * FROM catalogo WHERE tipo = 'Peça' ORDER BY nome ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.post('/api/estoque/:id/entrada', (req, res) => {
    const quantidade = parseInt(req.body.quantidade) || 0;
    if (quantidade <= 0) return res.status(400).json({ erro: 'Quantidade inválida.' });

    db.run('UPDATE catalogo SET estoque_atual = estoque_atual + ? WHERE id = ?', [quantidade, req.params.id], function (err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ mensagem: 'Estoque reposto com sucesso!' });
    });
});

// ==========================================
// 2. ROTAS DE CLIENTES
// ==========================================
app.get('/api/clientes', (req, res) => {
    db.all('SELECT * FROM clientes WHERE ativo = 1 OR ativo IS NULL ORDER BY nome ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.post('/api/clientes', (req, res) => {
    const { nome, telefone, email, endereco } = req.body;
    const sql = `INSERT INTO clientes (nome, telefone, email, endereco, ativo) VALUES (?, ?, ?, ?, 1)`;
    db.run(sql, [nome, telefone, email, endereco], function (err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ id: this.lastID, mensagem: 'Cliente cadastrado com sucesso!' });
    });
});

// Atualizar dados do Cliente com sincronização nas OS em aberto
app.put('/api/clientes/:id', (req, res) => {
    const { nome, telefone, email, endereco } = req.body;
    const clienteId = req.params.id;

    const sql = `UPDATE clientes SET nome = ?, telefone = ?, email = ?, endereco = ? WHERE id = ?`;
    db.run(sql, [nome, telefone, email, endereco, clienteId], function (err) {
        if (err) return res.status(500).json({ erro: err.message });

        // Sincroniza dados em todas as OS que NÃO estão concluídas
        const sqlSyncOS = `
            UPDATE ordens_servico 
            SET cliente_nome_salvo = ?, 
                cliente_telefone_salvo = ?, 
                cliente_endereco_salvo = ? 
            WHERE cliente_id = ? 
              AND status != 'Concluída'
        `;
        db.run(sqlSyncOS, [nome, telefone, endereco, clienteId], function (errSync) {
            if (errSync) console.error('Erro na sincronização de OS abertas:', errSync.message);
            res.json({ mensagem: 'Cliente atualizado e ordens em aberto sincronizadas com sucesso!' });
        });
    });
});

app.delete('/api/clientes/:id', (req, res) => {
    db.run(`UPDATE clientes SET ativo = 0 WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ mensagem: 'Cliente removido das listagens!' });
    });
});

// ==========================================
// 3. ROTAS DE ORDENS DE SERVIÇO
// ==========================================
app.get('/api/os', (req, res) => {
    const sql = `
        SELECT 
            os.*, 
            COALESCE(os.cliente_nome_salvo, c.nome, 'Cliente Não Identificado') AS cliente_nome, 
            COALESCE(os.cliente_telefone_salvo, c.telefone, '') AS cliente_telefone
        FROM ordens_servico os
        LEFT JOIN clientes c ON os.cliente_id = c.id
        ORDER BY os.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.get('/api/os/:id', (req, res) => {
    const osId = req.params.id;
    const sqlOS = `
        SELECT 
            os.*, 
            COALESCE(os.cliente_nome_salvo, c.nome, 'Cliente Não Identificado') AS cliente_nome, 
            COALESCE(os.cliente_telefone_salvo, c.telefone, '') AS cliente_telefone, 
            c.email AS cliente_email, 
            COALESCE(os.cliente_endereco_salvo, c.endereco, '') AS cliente_endereco
        FROM ordens_servico os
        LEFT JOIN clientes c ON os.cliente_id = c.id
        WHERE os.id = ?
    `;

    db.get(sqlOS, [osId], (err, os) => {
        if (err) return res.status(500).json({ erro: err.message });
        if (!os) return res.status(404).json({ erro: 'OS não encontrada.' });

        const sqlItens = `
            SELECT 
                oi.*, 
                COALESCE(oi.item_nome_salvo, cat.nome, 'Item Removido') AS item_nome, 
                COALESCE(oi.item_tipo_salvo, cat.tipo, 'Serviço') AS item_tipo, 
                COALESCE(oi.dias_garantia_salvo, cat.dias_garantia, 0) AS dias_garantia
            FROM os_itens oi
            LEFT JOIN catalogo cat ON oi.catalogo_id = cat.id
            WHERE oi.os_id = ?
        `;

        db.all(sqlItens, [osId], (errItens, itens) => {
            if (errItens) return res.status(500).json({ erro: errItens.message });
            res.json({ ...os, itens: itens || [] });
        });
    });
});

app.post('/api/os', (req, res) => {
    const { 
        cliente_id, 
        cliente_nome, 
        cliente_telefone, 
        cliente_endereco, 
        dispositivo_tipo,
        dispositivo_modelo,
        dispositivo_serial,
        data_entrada, 
        previsao_entrega, 
        defeito_relatado, 
        laudo_tecnico, 
        itens 
    } = req.body;

    db.get('SELECT * FROM clientes WHERE id = ?', [cliente_id], (errCli, cli) => {
        const nomeSalvo = cliente_nome || (cli ? cli.nome : 'Cliente Não Informado');
        const telSalvo = cliente_telefone || (cli ? cli.telefone : '');
        const endSalvo = cliente_endereco || (cli ? cli.endereco : '');

        const sqlOS = `
            INSERT INTO ordens_servico (
                cliente_id, 
                cliente_nome_salvo, 
                cliente_telefone_salvo, 
                cliente_endereco_salvo, 
                dispositivo_tipo,
                dispositivo_modelo,
                dispositivo_serial,
                data_entrada, 
                previsao_entrega, 
                defeito_relatado, 
                laudo_tecnico, 
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Orçamento')
        `;

        db.run(sqlOS, [
            cliente_id, 
            nomeSalvo, 
            telSalvo, 
            endSalvo, 
            dispositivo_tipo || 'Outros',
            dispositivo_modelo || '',
            dispositivo_serial || '',
            data_entrada, 
            previsao_entrega, 
            defeito_relatado, 
            laudo_tecnico
        ], function (err) {
            if (err) return res.status(500).json({ erro: err.message });
            const osId = this.lastID;

            if (itens && itens.length > 0) {
                const sqlItem = `
                    INSERT INTO os_itens (
                        os_id, 
                        catalogo_id, 
                        item_nome_salvo, 
                        item_tipo_salvo, 
                        dias_garantia_salvo, 
                        quantidade, 
                        valor_unitario
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `;
                itens.forEach((item) => {
                    db.run(sqlItem, [
                        osId, 
                        item.catalogo_id, 
                        item.item_nome || '', 
                        item.item_tipo || '', 
                        item.dias_garantia || 0, 
                        item.quantidade, 
                        item.valor_unitario
                    ]);

                    if (item.item_tipo === 'Peça' && item.catalogo_id) {
                        db.run(
                            'UPDATE catalogo SET estoque_atual = estoque_atual - ? WHERE id = ? AND tipo = "Peça"',
                            [item.quantidade, item.catalogo_id]
                        );
                    }
                });
            }
            res.json({ id: osId, mensagem: 'Ordem de Serviço criada com sucesso!' });
        });
    });
});

app.put('/api/os/:id', (req, res) => {
    const { 
        cliente_nome_salvo, 
        cliente_telefone_salvo, 
        cliente_endereco_salvo, 
        dispositivo_tipo,
        dispositivo_modelo,
        dispositivo_serial,
        defeito_relatado, 
        laudo_tecnico, 
        previsao_entrega 
    } = req.body;

    const sql = `
        UPDATE ordens_servico 
        SET cliente_nome_salvo = ?, 
            cliente_telefone_salvo = ?, 
            cliente_endereco_salvo = ?, 
            dispositivo_tipo = ?,
            dispositivo_modelo = ?,
            dispositivo_serial = ?,
            defeito_relatado = ?, 
            laudo_tecnico = ?, 
            previsao_entrega = ? 
        WHERE id = ?
    `;

    db.run(sql, [
        cliente_nome_salvo, 
        cliente_telefone_salvo, 
        cliente_endereco_salvo, 
        dispositivo_tipo,
        dispositivo_modelo,
        dispositivo_serial,
        defeito_relatado, 
        laudo_tecnico, 
        previsao_entrega, 
        req.params.id
    ], function (err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ mensagem: 'OS atualizada com sucesso!' });
    });
});

app.patch('/api/os/:id/status', (req, res) => {
    const { status, data_conclusao } = req.body;
    const sql = `UPDATE ordens_servico SET status = ?, data_conclusao = ? WHERE id = ?`;
    db.run(sql, [status, data_conclusao || null, req.params.id], function (err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ mensagem: 'Status atualizado com sucesso!' });
    });
});

app.delete('/api/os/:id', (req, res) => {
    const osId = req.params.id;

    const sqlItens = `
        SELECT oi.catalogo_id, oi.quantidade, oi.item_tipo_salvo, cat.tipo 
        FROM os_itens oi 
        LEFT JOIN catalogo cat ON cat.id = oi.catalogo_id 
        WHERE oi.os_id = ?
    `;
    db.all(sqlItens, [osId], (errItensBusca, itens) => {
        if (!errItensBusca && itens) {
            itens.forEach(item => {
                const ehPeca = item.item_tipo_salvo === 'Peça' || item.tipo === 'Peça';
                if (ehPeca && item.catalogo_id) {
                    db.run(
                        'UPDATE catalogo SET estoque_atual = estoque_atual + ? WHERE id = ?',
                        [item.quantidade, item.catalogo_id]
                    );
                }
            });
        }

        db.all('SELECT caminho_arquivo FROM anexos WHERE os_id = ?', [osId], (err, fotos) => {
            if (!err && fotos && fotos.length > 0) {
                fotos.forEach(f => {
                    if (f && f.caminho_arquivo) {
                        const caminhoRelativo = f.caminho_arquivo.replace(/^\/+/, '');
                        const ficheiroFisico = path.join(__dirname, caminhoRelativo);
                        try {
                            if (fs.existsSync(ficheiroFisico)) fs.unlinkSync(ficheiroFisico);
                        } catch (e) {
                            console.error('Aviso ao apagar arquivo físico:', e.message);
                        }
                    }
                });
            }

            db.run('DELETE FROM anexos WHERE os_id = ?', [osId], (errAnexos) => {
                if (errAnexos) return res.status(500).json({ erro: 'Erro ao apagar anexos.' });

                db.run('DELETE FROM os_itens WHERE os_id = ?', [osId], (errItens) => {
                    if (errItens) return res.status(500).json({ erro: 'Erro ao apagar itens.' });

                    db.run('DELETE FROM ordens_servico WHERE id = ?', [osId], function (errOS) {
                        if (errOS) return res.status(500).json({ erro: 'Erro ao apagar OS.' });
                        res.json({ mensagem: 'Ordem de Serviço excluída e peças devolvidas ao estoque!' });
                    });
                });
            });
        });
    });
});

// ==========================================
// 4. ROTAS DE FOTOS / ANEXOS
// ==========================================
app.get('/api/os/:id/anexos', (req, res) => {
    db.all('SELECT * FROM anexos WHERE os_id = ? ORDER BY id DESC', [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.post('/api/os/:id/anexos', upload.single('foto'), (req, res) => {
    if (!req.file) return res.status(400).json({ erro: 'Nenhuma foto enviada.' });

    const caminhoArquivo = `/uploads/${req.file.filename}`;
    const sql = 'INSERT INTO anexos (os_id, caminho_arquivo) VALUES (?, ?)';
    db.run(sql, [req.params.id, caminhoArquivo], function (err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ id: this.lastID, caminho_arquivo: caminhoArquivo, mensagem: 'Foto anexada com sucesso!' });
    });
});

app.delete('/api/anexos/:id', (req, res) => {
    db.get('SELECT * FROM anexos WHERE id = ?', [req.params.id], (err, anexo) => {
        if (err || !anexo) return res.status(404).json({ erro: 'Anexo não encontrado.' });

        const caminhoRelativo = anexo.caminho_arquivo.replace(/^\/+/, '');
        const ficheiroFisico = path.join(__dirname, caminhoRelativo);
        if (fs.existsSync(ficheiroFisico)) {
            try {
                fs.unlinkSync(ficheiroFisico);
            } catch (e) {
                console.error('Aviso ao apagar arquivo físico:', e.message);
            }
        }

        db.run('DELETE FROM anexos WHERE id = ?', [req.params.id], (errDel) => {
            if (errDel) return res.status(500).json({ erro: errDel.message });
            res.json({ mensagem: 'Foto removida com sucesso!' });
        });
    });
});

// ==========================================
// 5. INTELIGÊNCIA: VERIFICAR GARANTIAS
// ==========================================
app.get('/api/clientes/:id/garantias', (req, res) => {
    const clienteId = req.params.id;
    const sql = `
        SELECT 
            os.id AS os_id,
            COALESCE(os.data_conclusao, os.data_entrada) AS data_referencia,
            COALESCE(oi.item_nome_salvo, cat.nome) AS item_nome,
            COALESCE(oi.dias_garantia_salvo, cat.dias_garantia, 0) AS dias_garantia
        FROM ordens_servico os
        JOIN os_itens oi ON oi.os_id = os.id
        LEFT JOIN catalogo cat ON cat.id = oi.catalogo_id
        WHERE os.cliente_id = ? 
          AND COALESCE(oi.dias_garantia_salvo, cat.dias_garantia, 0) > 0
        ORDER BY os.id DESC
    `;

    db.all(sql, [clienteId], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });

        const hoje = new Date();
        const garantiasAtivas = [];

        rows.forEach(item => {
            if (!item.data_referencia) return;
            const dataBase = new Date(item.data_referencia + 'T00:00:00');
            const diffDias = Math.floor((hoje - dataBase) / (1000 * 60 * 60 * 24));
            const diasRestantes = item.dias_garantia - diffDias;

            if (diasRestantes >= 0) {
                garantiasAtivas.push({
                    os_id: item.os_id,
                    item_nome: item.item_nome,
                    dias_garantia: item.dias_garantia,
                    dias_restantes: diasRestantes,
                    data_referencia: item.data_referencia
                });
            }
        });

        res.json(garantiasAtivas);
    });
});

// ==========================================
// 6. BACKUP COMPLETO
// ==========================================
app.get('/api/backup', (req, res) => {
    const hoje = new Date().toISOString().slice(0, 10);
    const nomeZip = `backup-sistema-os-${hoje}.zip`;

    res.attachment(nomeZip);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => res.status(500).send({ erro: err.message }));
    archive.pipe(res);

    const bancoPath = path.join(__dirname, 'banco.sqlite');
    if (fs.existsSync(bancoPath)) {
        archive.file(bancoPath, { name: 'banco.sqlite' });
    }

    if (fs.existsSync(pastaUploads)) {
        archive.directory(pastaUploads, 'uploads');
    }

    archive.finalize();
});

// Inicia o servidor local
app.listen(PORT, () => {
    console.log(`Servidor rodando em: http://localhost:${PORT}`);
});