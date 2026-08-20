const express = require('express');
const path = require('path');
const pool = require('./db');

const app = express();

const PORT = process.env.PORT || 3000;

// Permite receber dados JSON
app.use(express.json());

// Disponibiliza os arquivos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de teste para verificar a conexão com o banco de dados ProstgerSQL
app.get('/api/teste-banco', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT NOW() AS agora');

        res.json({
            sucesso: true,
            mensagem: 'PostgreSQL conectado com sucesso!',
            horarioBanco: resultado.rows[0].agora
        });

    } catch (error) {
        console.error('❌ Erro ao conectar ao PostgreSQL:', error);

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao conectar ao PostgreSQL'
        });
    }
});

app.post('/api/planejamentos', async (req, res) => {

    const {
        semana,
        dia,
        bloco_id,
        hora_inicio,
        hora_fim,
        local,
        observacao,
        atividades
    } = req.body;

    if (!semana || !dia || !bloco_id) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Semana, dia e bloco_id são obrigatórios.'
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const resultado = await client.query(
            `
            INSERT INTO planejamentos
            (
                semana,
                dia,
                bloco_id,
                hora_inicio,
                hora_fim,
                local,
                observacao
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)

            ON CONFLICT (semana, dia, bloco_id)

            DO UPDATE SET
                hora_inicio = EXCLUDED.hora_inicio,
                hora_fim = EXCLUDED.hora_fim,
                local = EXCLUDED.local,
                observacao = EXCLUDED.observacao,
                updated_at = CURRENT_TIMESTAMP

            RETURNING id;
            `,
            [
                semana,
                dia,
                bloco_id,
                hora_inicio || null,
                hora_fim || null,
                local || null,
                observacao || null
            ]
        );

        const planejamentoId = resultado.rows[0].id;

        await client.query(
            'DELETE FROM atividades WHERE planejamento_id = $1',
            [planejamentoId]
        );

        if (Array.isArray(atividades)) {
            for (const atividade of atividades) {
                const texto = String(atividade).trim();

                if (texto) {
                    await client.query(
                        `
                        INSERT INTO atividades
                        (planejamento_id, atividade)
                        VALUES ($1, $2)
                        `,
                        [planejamentoId, texto]
                    );
                }
            }
        }

        await client.query('COMMIT');

        res.json({
            sucesso: true,
            mensagem: 'Planejamento salvo com sucesso!',
            id: planejamentoId
        });

    } catch (error) {
        await client.query('ROLLBACK');

        console.error('❌ Erro ao salvar planejamento:', error);

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao salvar planejamento.'
        });

    } finally {
        client.release();
    }
});

// ======================================================
// COPIAR PLANEJAMENTOS DA SEMANA ANTERIOR
// ======================================================

app.post('/api/planejamentos/copiar-semana', async (req, res) => {

    const {
        semana_origem,
        semana_destino
    } = req.body;

    if (!semana_origem || !semana_destino) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Semana de origem e semana de destino são obrigatórias.'
        });
    }

    // Impede copiar uma semana para ela mesma
    if (semana_origem === semana_destino) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'A semana de origem deve ser diferente da semana de destino.'
        });
    }

    const client = await pool.connect();

    try {

        await client.query('BEGIN');

        // --------------------------------------------------
        // 1. Busca todos os planejamentos da semana anterior
        // --------------------------------------------------

        const planejamentosOrigem = await client.query(
            `
            SELECT
                id,
                dia,
                bloco_id,
                hora_inicio,
                hora_fim,
                local,
                observacao
            FROM planejamentos
            WHERE semana = $1
            ORDER BY dia, hora_inicio
            `,
            [semana_origem]
        );

        if (planejamentosOrigem.rows.length === 0) {

            await client.query('ROLLBACK');

            return res.status(404).json({
                sucesso: false,
                mensagem: 'Nenhum planejamento encontrado na semana anterior.'
            });
        }

        let totalCopiados = 0;

        // --------------------------------------------------
        // 2. Percorre os planejamentos encontrados
        // --------------------------------------------------

        for (const planejamento of planejamentosOrigem.rows) {

            // Cria ou atualiza o planejamento na semana destino
            const resultado = await client.query(
                `
                INSERT INTO planejamentos
                (
                    semana,
                    dia,
                    bloco_id,
                    hora_inicio,
                    hora_fim,
                    local,
                    observacao
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)

                ON CONFLICT (semana, dia, bloco_id)

                DO UPDATE SET
                    hora_inicio = EXCLUDED.hora_inicio,
                    hora_fim = EXCLUDED.hora_fim,
                    local = EXCLUDED.local,
                    observacao = EXCLUDED.observacao,
                    updated_at = CURRENT_TIMESTAMP

                RETURNING id
                `,
                [
                    semana_destino,
                    planejamento.dia,
                    planejamento.bloco_id,
                    planejamento.hora_inicio,
                    planejamento.hora_fim,
                    planejamento.local,
                    planejamento.observacao
                ]
            );

            const novoPlanejamentoId = resultado.rows[0].id;

            // --------------------------------------------------
            // 3. Limpa atividades existentes no destino
            // --------------------------------------------------

            await client.query(
                `
                DELETE FROM atividades
                WHERE planejamento_id = $1
                `,
                [novoPlanejamentoId]
            );

            // --------------------------------------------------
            // 4. Busca atividades do planejamento original
            // --------------------------------------------------

            const atividadesOrigem = await client.query(
                `
                SELECT atividade
                FROM atividades
                WHERE planejamento_id = $1
                ORDER BY id
                `,
                [planejamento.id]
            );

            // --------------------------------------------------
            // 5. Copia as atividades
            // --------------------------------------------------

            for (const atividade of atividadesOrigem.rows) {

                await client.query(
                    `
                    INSERT INTO atividades
                    (
                        planejamento_id,
                        atividade
                    )
                    VALUES ($1, $2)
                    `,
                    [
                        novoPlanejamentoId,
                        atividade.atividade
                    ]
                );
            }

            totalCopiados++;
        }

        await client.query('COMMIT');

        res.json({
            sucesso: true,
            mensagem: 'Semana anterior copiada com sucesso!',
            semana_origem,
            semana_destino,
            totalCopiados
        });

    } catch (error) {

        await client.query('ROLLBACK');

        console.error(
            '❌ Erro ao copiar semana:',
            error
        );

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao copiar semana.'
        });

    } finally {

        client.release();
    }
});

// Buscar todos os planejamentos de uma semana
app.get('/api/planejamentos/:semana', async (req, res) => {

    const { semana } = req.params;

    try {

        const resultado = await pool.query(
            `
            SELECT
                p.id,
                p.semana,
                p.dia,
                p.bloco_id,
                p.hora_inicio,
                p.hora_fim,
                p.local,
                p.observacao,
                COALESCE(
                    json_agg(
                        a.atividade
                        ORDER BY a.id
                    ) FILTER (WHERE a.id IS NOT NULL),
                    '[]'
                ) AS atividades

            FROM planejamentos p

            LEFT JOIN atividades a
                ON a.planejamento_id = p.id

            WHERE p.semana = $1

            GROUP BY p.id

            ORDER BY
                p.dia,
                p.hora_inicio;
            `,
            [semana]
        );

        res.json({
            sucesso: true,
            semana: semana,
            planejamentos: resultado.rows
        });

    } catch (error) {

        console.error(
            '❌ Erro ao buscar planejamentos:',
            error
        );

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao buscar planejamentos.'
        });
    }
});

// Excluir um bloco do planejamento
app.delete('/api/planejamentos/:semana/:dia/:blocoId', async (req, res) => {
    const { semana, dia, blocoId } = req.params;

    try {
        const resultado = await pool.query(
            `
            DELETE FROM planejamentos
            WHERE semana = $1
              AND dia = $2
              AND bloco_id = $3
            RETURNING id
            `,
            [semana, dia, blocoId]
        );

        if (resultado.rowCount === 0) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Planejamento não encontrado.'
            });
        }

        res.json({
            sucesso: true,
            mensagem: 'Planejamento excluído com sucesso!'
        });

    } catch (error) {
        console.error('❌ Erro ao excluir planejamento:', error);

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao excluir planejamento.'
        });
    }
});

// Buscar opções salvas
app.get('/api/opcoes', async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT tipo, valor
            FROM opcoes
            ORDER BY tipo, valor
        `);

        res.json({
            sucesso: true,
            opcoes: resultado.rows
        });

    } catch (error) {
        console.error('❌ Erro ao buscar opções:', error);

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao buscar opções.'
        });
    }
});


// Salvar uma nova opção
app.post('/api/opcoes', async (req, res) => {

    const { tipo, valor } = req.body;

    if (!tipo || !valor) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Tipo e valor são obrigatórios.'
        });
    }

    try {
        await pool.query(
            `
            INSERT INTO opcoes (tipo, valor)
            VALUES ($1, $2)

            ON CONFLICT (tipo, valor)
            DO NOTHING
            `,
            [
                tipo.trim(),
                valor.trim()
            ]
        );

        res.json({
            sucesso: true,
            mensagem: 'Opção salva com sucesso!'
        });

    } catch (error) {
        console.error('❌ Erro ao salvar opção:', error);

        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao salvar opção.'
        });
    }
});



// Inicia o servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});