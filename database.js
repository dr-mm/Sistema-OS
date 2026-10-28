const sqlite3 = require('sqlite3').verbose();

// Isso vai criar um arquivo chamado 'banco.sqlite' na sua pasta
const db = new sqlite3.Database('./banco.sqlite', (err) => {
    if (err) {
        console.error('Erro ao conectar com o banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
    }
});

// Criando as Tabelas
db.serialize(() => {
    // 1. Tabela Clientes
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        telefone TEXT,
        email TEXT,
        endereco TEXT
    )`);

    // 2. Tabela Catálogo (Serviços e Peças)
    db.run(`CREATE TABLE IF NOT EXISTS catalogo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        tipo TEXT, 
        preco REAL,
        dias_garantia INTEGER
    )`);

    // 3. Tabela Ordens de Serviço
    db.run(`CREATE TABLE IF NOT EXISTS ordens_servico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER,
        status TEXT DEFAULT 'Orçamento',
        data_entrada TEXT,
        previsao_entrega TEXT,
        data_conclusao TEXT,
        defeito_relatado TEXT,
        laudo_tecnico TEXT,
        FOREIGN KEY(cliente_id) REFERENCES clientes(id)
    )`);

    // 4. Tabela OS_Itens (O que foi usado na OS)
    db.run(`CREATE TABLE IF NOT EXISTS os_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        os_id INTEGER,
        catalogo_id INTEGER,
        quantidade INTEGER,
        valor_unitario REAL,
        FOREIGN KEY(os_id) REFERENCES ordens_servico(id),
        FOREIGN KEY(catalogo_id) REFERENCES catalogo(id)
    )`);

    // 5. Tabela Anexos (Caminho das Fotos)
    db.run(`CREATE TABLE IF NOT EXISTS anexos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        os_id INTEGER,
        caminho_arquivo TEXT,
        FOREIGN KEY(os_id) REFERENCES ordens_servico(id)
    )`);

    console.log("Todas as 5 tabelas foram criadas com sucesso!");
});

db.close();