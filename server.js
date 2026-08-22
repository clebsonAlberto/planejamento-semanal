/* ========================================
   IMPORTAÇÕES
   ======================================== */

const express =
  require('express');

const path =
  require('path');

const pool =
  require('./db');

const session =
  require('express-session');

const bcrypt =
  require('bcrypt');


/* ========================================
   CONFIGURAÇÃO DO EXPRESS
   ======================================== */

const app =
  express();

const PORT =
  process.env.PORT || 3000;


/* ========================================
   MIDDLEWARE - JSON
   ======================================== */

app.use(
  express.json()
);


/* ========================================
   ARQUIVOS ESTÁTICOS
   ======================================== */

app.use(
  express.static(
    path.join(
      __dirname,
      'public'
    )
  )
);


/* ========================================
   ROTA PRINCIPAL
   ======================================== */

app.get(
  '/',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );

  }
);


/* ========================================
   CONFIGURAÇÃO DA SESSÃO
   ======================================== */

/*
   A sessão permanece válida
   por 8 horas.
*/

app.use(
  session({

    secret:
      process.env.SESSION_SECRET ||
      'planejamento-semanal-secret',

    resave:
      false,

    saveUninitialized:
      false,

    cookie: {

      maxAge:
        1000 *
        60 *
        60 *
        8

    }

  })
);


/* ========================================
   TESTE DE CONEXÃO COM POSTGRESQL
   ======================================== */

app.get(
  '/api/teste-banco',

  async (req, res) => {

    try {

      const resultado =
        await pool.query(
          'SELECT NOW() AS agora'
        );


      res.json({

        sucesso:
          true,

        mensagem:
          'PostgreSQL conectado com sucesso!',

        horarioBanco:
          resultado.rows[0].agora

      });


    } catch (error) {

      console.error(
        '❌ Erro ao conectar ao PostgreSQL:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao conectar ao PostgreSQL'

        });

    }

  }
);


/* ========================================
   PLANEJAMENTOS
   ======================================== */


/* ========================================
   SALVAR OU ATUALIZAR PLANEJAMENTO
   ======================================== */

app.post(
  '/api/planejamentos',

  async (req, res) => {

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


    /* ========================================
       VALIDAÇÃO DOS CAMPOS OBRIGATÓRIOS
       ======================================== */

    if (
      !semana ||
      !dia ||
      !bloco_id
    ) {

      return res
        .status(400)
        .json({

          sucesso:
            false,

          mensagem:
            'Semana, dia e bloco_id são obrigatórios.'

        });

    }


    const client =
      await pool.connect();


    try {

      /* ========================================
         INICIAR TRANSAÇÃO
         ======================================== */

      await client.query(
        'BEGIN'
      );


      /* ========================================
         SALVAR O BLOCO
         ======================================== */

      const resultado =
        await client.query(
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

            VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7
            )

            ON CONFLICT
            (
              semana,
              dia,
              bloco_id
            )

            DO UPDATE SET

              hora_inicio =
                EXCLUDED.hora_inicio,

              hora_fim =
                EXCLUDED.hora_fim,

              local =
                EXCLUDED.local,

              observacao =
                EXCLUDED.observacao,

              updated_at =
                CURRENT_TIMESTAMP

            RETURNING id;
          `,
          [

            semana,
            dia,
            bloco_id,

            hora_inicio ||
              null,

            hora_fim ||
              null,

            local ||
              null,

            observacao ||
              null

          ]
        );


      const planejamentoId =
        resultado.rows[0].id;


      /* ========================================
         REMOVER ATIVIDADES ANTIGAS
         ======================================== */

      await client.query(
        `
          DELETE FROM atividades
          WHERE planejamento_id = $1
        `,
        [
          planejamentoId
        ]
      );


      /* ========================================
         SALVAR PROPOSTAS / ATIVIDADES
         ======================================== */

      if (
        Array.isArray(
          atividades
        )
      ) {

        for (
          const atividade
          of atividades
        ) {

          const texto =
            String(
              atividade
            ).trim();


          if (texto) {

            await client.query(
              `
                INSERT INTO atividades
                (
                  planejamento_id,
                  atividade
                )

                VALUES
                (
                  $1,
                  $2
                )
              `,
              [
                planejamentoId,
                texto
              ]
            );

          }

        }

      }


      /* ========================================
         CONFIRMAR TRANSAÇÃO
         ======================================== */

      await client.query(
        'COMMIT'
      );


      res.json({

        sucesso:
          true,

        mensagem:
          'Planejamento salvo com sucesso!',

        id:
          planejamentoId

      });


    } catch (error) {

      /* ========================================
         CANCELAR TRANSAÇÃO EM CASO DE ERRO
         ======================================== */

      await client.query(
        'ROLLBACK'
      );


      console.error(
        '❌ Erro ao salvar planejamento:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao salvar planejamento.'

        });


    } finally {

      client.release();

    }

  }
);


/* ========================================
   COPIAR PLANEJAMENTOS DA SEMANA ANTERIOR
   ======================================== */

app.post(
  '/api/planejamentos/copiar-semana',

  async (req, res) => {

    const {

      semana_origem,
      semana_destino

    } = req.body;


    /* ========================================
       VALIDAR SEMANAS
       ======================================== */

    if (
      !semana_origem ||
      !semana_destino
    ) {

      return res
        .status(400)
        .json({

          sucesso:
            false,

          mensagem:
            'Semana de origem e semana de destino são obrigatórias.'

        });

    }


    /* ========================================
       IMPEDIR CÓPIA PARA A MESMA SEMANA
       ======================================== */

    if (
      semana_origem ===
      semana_destino
    ) {

      return res
        .status(400)
        .json({

          sucesso:
            false,

          mensagem:
            'A semana de origem deve ser diferente da semana de destino.'

        });

    }


    const client =
      await pool.connect();


    try {

      /* ========================================
         INICIAR TRANSAÇÃO
         ======================================== */

      await client.query(
        'BEGIN'
      );


      /* ========================================
         BUSCAR PLANEJAMENTOS DA SEMANA ANTERIOR
         ======================================== */

      const planejamentosOrigem =
        await client.query(
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

            ORDER BY
              dia,
              hora_inicio
          `,
          [
            semana_origem
          ]
        );


      /* ========================================
         VERIFICAR SE EXISTEM PLANEJAMENTOS
         ======================================== */

      if (
        planejamentosOrigem
          .rows
          .length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );


        return res
          .status(404)
          .json({

            sucesso:
              false,

            mensagem:
              'Nenhum planejamento encontrado na semana anterior.'

          });

      }


      let totalCopiados =
        0;


      /* ========================================
         PERCORRER PLANEJAMENTOS
         ======================================== */

      for (
        const planejamento
        of planejamentosOrigem.rows
      ) {


        /* ========================================
           CRIAR OU ATUALIZAR NO DESTINO
           ======================================== */

        const resultado =
          await client.query(
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

              VALUES
              (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7
              )

              ON CONFLICT
              (
                semana,
                dia,
                bloco_id
              )

              DO UPDATE SET

                hora_inicio =
                  EXCLUDED.hora_inicio,

                hora_fim =
                  EXCLUDED.hora_fim,

                local =
                  EXCLUDED.local,

                observacao =
                  EXCLUDED.observacao,

                updated_at =
                  CURRENT_TIMESTAMP

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


        const novoPlanejamentoId =
          resultado.rows[0].id;


        /* ========================================
           LIMPAR ATIVIDADES DO DESTINO
           ======================================== */

        await client.query(
          `
            DELETE FROM atividades
            WHERE planejamento_id = $1
          `,
          [
            novoPlanejamentoId
          ]
        );


        /* ========================================
           BUSCAR ATIVIDADES DA ORIGEM
           ======================================== */

        const atividadesOrigem =
          await client.query(
            `
              SELECT atividade

              FROM atividades

              WHERE planejamento_id = $1

              ORDER BY id
            `,
            [
              planejamento.id
            ]
          );


        /* ========================================
           COPIAR ATIVIDADES
           ======================================== */

        for (
          const atividade
          of atividadesOrigem.rows
        ) {

          await client.query(
            `
              INSERT INTO atividades
              (
                planejamento_id,
                atividade
              )

              VALUES
              (
                $1,
                $2
              )
            `,
            [
              novoPlanejamentoId,
              atividade.atividade
            ]
          );

        }


        totalCopiados++;

      }


      /* ========================================
         CONFIRMAR TRANSAÇÃO
         ======================================== */

      await client.query(
        'COMMIT'
      );


      res.json({

        sucesso:
          true,

        mensagem:
          'Semana anterior copiada com sucesso!',

        semana_origem,
        semana_destino,
        totalCopiados

      });


    } catch (error) {

      /* ========================================
         CANCELAR TRANSAÇÃO
         ======================================== */

      await client.query(
        'ROLLBACK'
      );


      console.error(
        '❌ Erro ao copiar semana:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao copiar semana.'

        });


    } finally {

      client.release();

    }

  }
);

/* ========================================
   BUSCAR PLANEJAMENTOS DE UMA SEMANA
   ======================================== */

app.get(
  '/api/planejamentos/:semana',

  async (req, res) => {

    const {
      semana
    } = req.params;


    try {

      const resultado =
        await pool.query(
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
                )
                FILTER (
                  WHERE a.id IS NOT NULL
                ),
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
          [
            semana
          ]
        );


      res.json({

        sucesso:
          true,

        semana:
          semana,

        planejamentos:
          resultado.rows

      });


    } catch (error) {

      console.error(
        '❌ Erro ao buscar planejamentos:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao buscar planejamentos.'

        });

    }

  }
);


/* ========================================
   EXCLUIR UM BLOCO DO PLANEJAMENTO
   ======================================== */

app.delete(
  '/api/planejamentos/:semana/:dia/:blocoId',

  async (req, res) => {

    const {
      semana,
      dia,
      blocoId
    } = req.params;


    try {

      const resultado =
        await pool.query(
          `
            DELETE FROM planejamentos

            WHERE semana = $1
              AND dia = $2
              AND bloco_id = $3

            RETURNING id
          `,
          [
            semana,
            dia,
            blocoId
          ]
        );


      /* ========================================
         VERIFICAR SE O BLOCO EXISTIA
         ======================================== */

      if (
        resultado.rowCount === 0
      ) {

        return res
          .status(404)
          .json({

            sucesso:
              false,

            mensagem:
              'Planejamento não encontrado.'

          });

      }


      res.json({

        sucesso:
          true,

        mensagem:
          'Planejamento excluído com sucesso!'

      });


    } catch (error) {

      console.error(
        '❌ Erro ao excluir planejamento:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao excluir planejamento.'

        });

    }

  }
);


/* ========================================
   OPÇÕES DE LOCAL E PROPOSTAS
   ======================================== */


/* ========================================
   BUSCAR OPÇÕES SALVAS
   ======================================== */

app.get(
  '/api/opcoes',

  async (req, res) => {

    try {

      const resultado =
        await pool.query(
          `
            SELECT
              tipo,
              valor

            FROM opcoes

            ORDER BY
              tipo,
              valor
          `
        );


      res.json({

        sucesso:
          true,

        opcoes:
          resultado.rows

      });


    } catch (error) {

      console.error(
        '❌ Erro ao buscar opções:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao buscar opções.'

        });

    }

  }
);


/* ========================================
   SALVAR NOVA OPÇÃO
   ======================================== */

app.post(
  '/api/opcoes',

  async (req, res) => {

    const {
      tipo,
      valor
    } = req.body;


    /* ========================================
       VALIDAR OPÇÃO
       ======================================== */

    if (
      !tipo ||
      !valor
    ) {

      return res
        .status(400)
        .json({

          sucesso:
            false,

          mensagem:
            'Tipo e valor são obrigatórios.'

        });

    }


    try {

      await pool.query(
        `
          INSERT INTO opcoes
          (
            tipo,
            valor
          )

          VALUES
          (
            $1,
            $2
          )

          ON CONFLICT
          (
            tipo,
            valor
          )

          DO NOTHING
        `,
        [
          tipo.trim(),
          valor.trim()
        ]
      );


      res.json({

        sucesso:
          true,

        mensagem:
          'Opção salva com sucesso!'

      });


    } catch (error) {

      console.error(
        '❌ Erro ao salvar opção:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao salvar opção.'

        });

    }

  }
);


/* ========================================
   CONFIGURAÇÕES DO CABEÇALHO
   ======================================== */

/*
   Dados armazenados:

   - Professora
   - Turma
   - Período
   - Escola
*/


/* ========================================
   BUSCAR CONFIGURAÇÕES
   ======================================== */

app.get(
  '/api/configuracoes',

  async (req, res) => {

    try {

      const resultado =
        await pool.query(
          `
            SELECT
              id,
              professora,
              turma,
              periodo,
              escola

            FROM configuracoes

            ORDER BY id DESC

            LIMIT 1
          `
        );


      /* ========================================
         NENHUMA CONFIGURAÇÃO CADASTRADA
         ======================================== */

      if (
        resultado.rows.length === 0
      ) {

        return res.json({

          sucesso:
            true,

          configuracao: {

            professora:
              '',

            turma:
              '',

            periodo:
              '',

            escola:
              'EMEI Viriato Correia'

          }

        });

      }


      /* ========================================
         RETORNAR CONFIGURAÇÃO ENCONTRADA
         ======================================== */

      res.json({

        sucesso:
          true,

        configuracao:
          resultado.rows[0]

      });


    } catch (error) {

      console.error(
        'Erro ao carregar configurações:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao carregar configurações.'

        });

    }

  }
);


/* ========================================
   SALVAR CONFIGURAÇÕES
   ======================================== */

app.post(
  '/api/configuracoes',

  async (req, res) => {

    try {

      const {

        professora,
        turma,
        periodo

      } = req.body;


      /* ========================================
         ESCOLA PADRÃO
         ======================================== */

      const escola =
        'EMEI Viriato Correia';


      /* ========================================
         PROCURAR CONFIGURAÇÃO EXISTENTE
         ======================================== */

      const existente =
        await pool.query(
          `
            SELECT id

            FROM configuracoes

            ORDER BY id DESC

            LIMIT 1
          `
        );


      let resultado;


      /* ========================================
         ATUALIZAR CONFIGURAÇÃO EXISTENTE
         ======================================== */

      if (
        existente.rows.length > 0
      ) {

        const id =
          existente.rows[0].id;


        resultado =
          await pool.query(
            `
              UPDATE configuracoes

              SET
                professora = $1,
                turma = $2,
                periodo = $3,
                escola = $4,
                updated_at = CURRENT_TIMESTAMP

              WHERE id = $5

              RETURNING *
            `,
            [
              professora || '',
              turma || '',
              periodo || '',
              escola,
              id
            ]
          );


      } else {


        /* ========================================
           CRIAR PRIMEIRA CONFIGURAÇÃO
           ======================================== */

        resultado =
          await pool.query(
            `
              INSERT INTO configuracoes
              (
                professora,
                turma,
                periodo,
                escola
              )

              VALUES
              (
                $1,
                $2,
                $3,
                $4
              )

              RETURNING *
            `,
            [
              professora || '',
              turma || '',
              periodo || '',
              escola
            ]
          );

      }


      /* ========================================
         CONFIGURAÇÃO SALVA
         ======================================== */

      res.json({

        sucesso:
          true,

        mensagem:
          'Configurações salvas com sucesso!',

        configuracao:
          resultado.rows[0]

      });


    } catch (error) {

      console.error(
        'Erro ao salvar configurações:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao salvar configurações.'

        });

    }

  }
);

/* ========================================
   LOGIN E SESSÃO
   ======================================== */


/* ========================================
   LOGIN DO USUÁRIO
   ======================================== */

app.post(
  '/api/login',

  async (req, res) => {

    try {

      const {
        email,
        senha
      } = req.body;


      /* ========================================
         VALIDAR CAMPOS
         ======================================== */

      if (
        !email ||
        !senha
      ) {

        return res
          .status(400)
          .json({

            sucesso:
              false,

            mensagem:
              'Informe email e senha.'

          });

      }


      /* ========================================
         BUSCAR USUÁRIO NO BANCO
         ======================================== */

      const resultado =
        await pool.query(
          `
            SELECT
              id,
              nome,
              email,
              senha_hash,
              perfil,
              ativo

            FROM usuarios

            WHERE LOWER(email) =
              LOWER($1)

            LIMIT 1
          `,
          [
            email.trim()
          ]
        );


      /* ========================================
         USUÁRIO NÃO ENCONTRADO
         ======================================== */

      if (
        resultado.rows.length === 0
      ) {

        return res
          .status(401)
          .json({

            sucesso:
              false,

            mensagem:
              'Email ou senha inválidos.'

          });

      }


      const usuario =
        resultado.rows[0];


      /* ========================================
         VERIFICAR SE O USUÁRIO ESTÁ ATIVO
         ======================================== */

      if (
        !usuario.ativo
      ) {

        return res
          .status(403)
          .json({

            sucesso:
              false,

            mensagem:
              'Usuário inativo.'

          });

      }


      /* ========================================
         COMPARAR SENHA COM BCRYPT
         ======================================== */

      const senhaCorreta =
        await bcrypt.compare(
          senha,
          usuario.senha_hash
        );


      /* ========================================
         SENHA INCORRETA
         ======================================== */

      if (
        !senhaCorreta
      ) {

        return res
          .status(401)
          .json({

            sucesso:
              false,

            mensagem:
              'Email ou senha inválidos.'

          });

      }


      /* ========================================
         CRIAR SESSÃO DO USUÁRIO
         ======================================== */

      req.session.usuario = {

        id:
          usuario.id,

        nome:
          usuario.nome,

        email:
          usuario.email,

        perfil:
          usuario.perfil

      };


      /* ========================================
         LOGIN REALIZADO
         ======================================== */

      res.json({

        sucesso:
          true,

        mensagem:
          'Login realizado com sucesso.',

        usuario:
          req.session.usuario

      });


    } catch (error) {

      console.error(
        'Erro no login:',
        error
      );


      res
        .status(500)
        .json({

          sucesso:
            false,

          mensagem:
            'Erro ao realizar login.'

        });

    }

  }
);


/* ========================================
   VERIFICAR USUÁRIO AUTENTICADO
   ======================================== */

app.get(
  '/api/me',

  (req, res) => {

    if (
      !req.session.usuario
    ) {

      return res
        .status(401)
        .json({

          sucesso:
            false,

          mensagem:
            'Não autenticado.'

        });

    }


    res.json({

      sucesso:
        true,

      usuario:
        req.session.usuario

    });

  }
);


/* ========================================
   LOGOUT
   ======================================== */

app.post(
  '/api/logout',

  (req, res) => {

    req.session.destroy(
      error => {

        if (error) {

          console.error(
            'Erro ao encerrar sessão:',
            error
          );


          return res
            .status(500)
            .json({

              sucesso:
                false,

              mensagem:
                'Erro ao sair.'

            });

        }


        /* ========================================
           LIMPAR COOKIE DA SESSÃO
           ======================================== */

        res.clearCookie(
          'connect.sid'
        );


        /* ========================================
           LOGOUT REALIZADO
           ======================================== */

        res.json({

          sucesso:
            true,

          mensagem:
            'Logout realizado com sucesso.'

        });

      }
    );

  }
);


/* ========================================
   INICIALIZAÇÃO DO SERVIDOR
   ======================================== */

app.listen(
  PORT,

  () => {

    console.log(
      `✅ Servidor rodando em http://localhost:${PORT}`
    );

  }
);